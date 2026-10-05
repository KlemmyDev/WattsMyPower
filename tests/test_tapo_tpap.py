"""TPAP, how Tapo plugs on the newest firmware are spoken to: SPAKE2+ against RFC 9383's test vectors, the password
hashes some firmware asks for against their specifications, and sign-in, requests and failures against a fake plug that
speaks the device's side. Nothing here touches the network."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import urllib.error
from collections.abc import Iterator
from typing import Any

import pytest

from app.features.home.integrations.tapo import Tapo, spake2plus
from app.features.home.integrations.tapo.crypt import md5_crypt, parse_sha256_prefix, sha256_crypt
from app.features.home.integrations.tapo.discovery import Found
from app.features.home.integrations.tapo.klap import TapoError, auth_hash
from app.features.home.integrations.tapo.klap import forget_sessions as forget_klap
from app.features.home.integrations.tapo.spake2plus import SUITES, Prover, derive_w, encode, encode_w, point
from app.features.home.integrations.tapo.tpap import (
    Session,
    TpapClient,
    credentials,
    default_passcode,
    forget_sessions,
)
from app.features.home.types import Hints, IntegrationError

EMAIL, PASSWORD = "Me@Example.com", "hunter22"
MAC = "20-23-51-5F-FA-2D"
NET = Hints(network="192.168.0.0/24")


def hexbytes(s: str) -> bytes:
    return bytes.fromhex("".join(s.split()))


# -- SPAKE2+ (RFC 9383, appendix C) --------------------------------------------------------------------------
def test_spake2plus_matches_rfc_9383s_test_vector() -> None:
    w0 = int("bb8e1bbcf3c48f62c08db243652ae55d3e5586053fca77102994f23ad95491b3", 16)
    w1 = int("7e945f34d78785b8a3ef44d0df5a1a97d6b3b460409a345ca7830387a74b1dba", 16)
    x = int("d1232c8e8693d02368976c174e2088851b8365d0d79a9eee709c6a05a2fad539", 16)
    share_v = hexbytes("""04c0f65da0d11927bdf5d560c69e1d7d939a05b0e88291887d679fcadea75810fb5cc1ca7494db39e82ff2f506652
                          55d76173e09986ab46742c798a9a68437b048""")
    result = Prover(SUITES[1], w0, w1, x).finish(
        share_v, b"SPAKE2+-P256-SHA256-HKDF-SHA256-HMAC-SHA256 Test Vectors", b"client", b"server"
    )
    assert result.share_p == hexbytes("""04ef3bd051bf78a2234ec0df197f7828060fe9856503579bb1733009042c15c0c1de127727f
                                         418b5966afadfdd95a6e4591d171056b333dab97a79c7193e341727""")
    assert hashlib.sha256(result.transcript).digest() == hexbytes(
        "4c59e1ccf2cfb961aa31bd9434478a1089b56cd11542f53d3576fb6c2a438a29"  # K_main
    )
    assert result.confirm_p == hexbytes("926cc713504b9b4d76c9162ded04b5493e89109f6d89462cd33adc46fda27527")
    assert result.confirm_v == hexbytes("9747bcc4f8fe9f63defee53ac9b07876d907d55047e6ff2def2e7529089d3e68")
    assert result.shared_key == hexbytes("0c5f8ccd1413423a54f6c1fb26ff01534a87f893779c6e68666d772bfd91f3e7")


def test_a_share_off_the_curve_is_refused() -> None:
    with pytest.raises(ValueError):
        Prover(SUITES[1], 5, 7).finish(b"\x04" + b"\x01" * 64, b"ctx")


def test_w0_goes_into_the_transcript_as_tpap_encodes_it() -> None:
    assert encode_w(0x80) == b"\x00\x80" and encode_w(0x7F) == b"\x7f" and encode_w(0x8000) == b"\x80\x00"


# -- the password hashes some firmware asks for ---------------------------------------------------------------
def test_md5_crypt_matches_openssl() -> None:
    assert md5_crypt("password", "3azHgidD") == "$1$3azHgidD$SrJPt7B.9rekpmwJwtON31"  # openssl passwd -1


@pytest.mark.parametrize(
    ("prefix", "password", "expected"),
    [  # from Ulrich Drepper's SHA-crypt specification
        ("$5$saltstring", "Hello world!", "$5$saltstring$5B8vYYiY.CVt1RlTTf8KbXBH3hsxY/GNooZaBBGWEc5"),
        ("$5$rounds=10000$saltstringsaltstring", "Hello world!",
         "$5$rounds=10000$saltstringsaltst$3xv.VbSHBb41AL9AvLeujZkZRBAwqFMz2.opqey6IcA"),
        ("$5$rounds=5000$toolongsaltstring", "This is just a test",
         "$5$rounds=5000$toolongsaltstrin$Un/5jzAHMgOGZ5.mWJpuVolil07guHPvOW8mGRcvxa5"),
        ("$5$rounds=10$roundstoolow", "the minimum number is still observed",
         "$5$rounds=1000$roundstoolow$yfvwcWrQ8l/K0DAWyuPMDNHpIVlTQebY9l/gL972bIC"),
    ],
)  # fmt: skip
def test_sha256_crypt_matches_its_specification(prefix: str, password: str, expected: str) -> None:
    salt, rounds = parse_sha256_prefix(prefix)
    assert sha256_crypt(password, salt, rounds) == expected


def test_what_goes_in_for_the_password() -> None:
    assert credentials(None, EMAIL, PASSWORD, MAC) == f"{EMAIL}/{PASSWORD}"  # a P110: no extra_crypt
    shadow = lambda which, **p: {"type": "password_shadow", "params": {"passwd_id": which, **p}}  # noqa: E731
    assert credentials(shadow(2), EMAIL, PASSWORD, MAC) == hashlib.sha1(PASSWORD.encode()).hexdigest()
    assert credentials(shadow(1, passwd_prefix="$1$3azHgidD$"), EMAIL, "password", MAC) == md5_crypt(
        "password", "3azHgidD"
    )
    assert credentials(shadow(5, passwd_prefix="$5$saltstring"), EMAIL, "Hello world!", MAC) == (
        "$5$saltstring$5B8vYYiY.CVt1RlTTf8KbXBH3hsxY/GNooZaBBGWEc5"
    )
    md5_user = hashlib.md5(EMAIL.encode()).hexdigest()
    assert (
        credentials(shadow(3), EMAIL, PASSWORD, MAC)
        == hashlib.sha1(f"{md5_user}_20:23:51:5F:FA:2D".encode()).hexdigest()
    )
    salted = {"type": "password_sha_with_salt", "params": {"sha_name": 0, "sha_salt": base64.b64encode(b"s").decode()}}
    assert credentials(salted, EMAIL, PASSWORD, MAC) == hashlib.sha256(f"admins{PASSWORD}".encode()).hexdigest()
    keyed = {"type": "password_authkey", "params": {"authkey_tmpkey": "ab", "authkey_dictionary": "XYZ"}}
    assert len(credentials(keyed, EMAIL, PASSWORD, MAC)) == len(PASSWORD)
    assert len(default_passcode(MAC)) == 64 and default_passcode(MAC) == default_passcode(MAC.lower().replace("-", ":"))


# -- a fake plug on TPAP ---------------------------------------------------------------------------------------
class TpapPlug:
    """The device's side of TPAP: login (discover, register, share) as the SPAKE2+ verifier, and the encrypted session."""

    def __init__(self, host: str, device_id: str, email: str = EMAIL, password: str = PASSWORD, *,
                 extra: dict[str, Any] | None = None, name: str = "Heater", power_mw: int = 1_250_000,
                 today_wh: int = 900, iterations: int = 1000) -> None:  # fmt: skip
        self.host, self.device_id, self.name, self.power_mw, self.today_wh = host, device_id, name, power_mw, today_wh
        self.extra, self.iterations, self.salt = extra, iterations, secrets.token_bytes(16)
        self.set_password(email, password)
        self.sessions: dict[str, Session] = {}
        self.logins = 0
        self.calls: list[str] = []
        self.blocked = False
        self.answer_with: int | None = None  # an error code to answer the next request with

    def set_password(self, email: str, password: str) -> None:
        secret = credentials(self.extra, email, password, MAC)
        self.w0, self.w1 = derive_w(secret.encode(), self.salt, self.iterations, "P-256")

    def __call__(self, path: str, body: bytes, headers: dict[str, str]) -> tuple[int, list[str], bytes]:
        if path.startswith("/app/"):
            return 403, [], b""  # TPAP firmware refuses KLAP
        if path == "/":
            return 200, [], json.dumps(self.login(json.loads(body)["params"])).encode()
        session = self.sessions.get(path.removeprefix("/stok=").removesuffix("/ds"))
        if session is None:
            return 200, [], json.dumps({"error_code": -40401}).encode()
        if self.answer_with is not None:
            code, self.answer_with = self.answer_with, None
            return 200, [], json.dumps({"error_code": code}).encode()
        request = json.loads(session.decrypt(body))
        self.calls.append(request["method"])
        reply = json.dumps(self.answer(request["method"])).encode()
        session.seq = int.from_bytes(body[:4], "big")  # answer under the request's sequence number
        return 200, [], session.encrypt(reply)[0]

    def login(self, params: dict[str, Any]) -> dict[str, Any]:
        step = params["sub_method"]
        if step == "discover":
            return {"error_code": 0, "result": {"mac": MAC, "tpap": {"tls": 0, "port": 80, "pake": [2], "dac": 0}}}
        if self.blocked:
            return {"error_code": -40404}
        suite = SUITES[1]
        G, order = spake2plus._curve("P-256").G, int(spake2plus._curve("P-256").order)
        M, N = (point(bytes.fromhex(p), "P-256") for p in spake2plus.POINTS["P-256"])
        if step == "pake_register":
            assert params["username"] == hashlib.md5(b"admin").hexdigest() and params["passcode_type"] == "userpw"
            self.user_random = base64.b64decode(params["user_random"])
            self.dev_random = secrets.token_bytes(32)
            self.y = secrets.randbelow(order - 1) + 1
            self.Y = G * self.y + N * self.w0
            result: dict[str, Any] = {"dev_random": base64.b64encode(self.dev_random).decode(),
                                      "dev_salt": base64.b64encode(self.salt).decode(),
                                      "dev_share": base64.b64encode(encode(self.Y, "P-256")).decode(),
                                      "cipher_suites": 1, "iterations": self.iterations, "encryption": "aes_128_ccm"}  # fmt: skip
            if self.extra:
                result["extra_crypt"] = self.extra
            return {"error_code": 0, "result": result}
        assert step == "pake_share"
        X = point(base64.b64decode(params["user_share"]), "P-256")
        base = X + (-(M * self.w0))
        Z, V = base * self.y, G * (self.w1 * self.y % order)  # V = y·L, with L = w1·G the verifier the device keeps
        context = hashlib.sha256(b"PAKE V1" + self.user_random + self.dev_random).digest()
        x_b, y_b = encode(X, "P-256"), encode(self.Y, "P-256")
        tt = b"".join(spake2plus._len8(v) for v in (context, b"", b"", encode(M, "P-256"), encode(N, "P-256"), x_b,
                                                     y_b, encode(Z, "P-256"), encode(V, "P-256"), encode_w(self.w0)))  # fmt: skip
        k_main = hashlib.sha256(tt).digest()
        keys = spake2plus._kdf(suite, k_main, b"ConfirmationKeys", 64)
        if base64.b64decode(params["user_confirm"]) != spake2plus._mac(suite, keys[:32], y_b):
            return {"error_code": -1501}  # not the password
        shared = spake2plus._kdf(suite, k_main, b"SharedKey", 32)
        self.logins += 1
        sid = secrets.token_hex(8)
        key = spake2plus.hkdf(shared, 16, b"tp-kdf-salt-aes128-key", suite.hash, b"tp-kdf-info-aes128-key")
        nonce = spake2plus.hkdf(shared, 12, b"tp-kdf-salt-aes128-iv", suite.hash, b"tp-kdf-info-aes128-iv")
        self.sessions[sid] = Session("", key, nonce, 5000)
        confirm = spake2plus._mac(suite, keys[32:], x_b)
        return {"error_code": 0, "result": {"dev_confirm": base64.b64encode(confirm).decode(), "stok": sid,
                                            "start_seq": 5000}}  # fmt: skip

    def answer(self, method: str) -> dict[str, Any]:
        if method == "get_device_info":
            return {"error_code": 0, "result": {"device_id": self.device_id, "model": "P110(AU)", "device_on": True,
                    "nickname": base64.b64encode(self.name.encode()).decode(), "fw_ver": "1.4.8"}}  # fmt: skip
        if method == "get_energy_usage":
            return {"error_code": 0, "result": {"today_energy": self.today_wh, "current_power": self.power_mw}}
        return {"error_code": -1}

    def found(self) -> Found:
        return Found(self.host, self.device_id, "P110(AU)", "SMART.TAPOPLUG", "TPAP", 80)


class Lan:
    def __init__(self, *plugs: Any):
        self.plugs = {p.host: p for p in plugs}

    def post(self, url: str, body: bytes, headers: dict[str, str], timeout: float) -> tuple[int, list[str], bytes]:
        host = url.split("/")[2].split(":")[0]
        if host not in self.plugs:
            raise urllib.error.URLError("timed out")
        return self.plugs[host]("/" + url.split("/", 3)[3], body, headers)

    def find(self, hosts: list[str]) -> list[Found]:
        return [p.found() for h, p in self.plugs.items() if h in hosts]


@pytest.fixture(autouse=True)
def fresh_sessions() -> Iterator[None]:
    forget_sessions()
    forget_klap()
    yield
    forget_sessions()
    forget_klap()


def client(lan: Lan, host: str = "192.168.0.6", password: str = PASSWORD) -> TpapClient:
    return TpapClient(host, EMAIL, password, post=lan.post)


def test_signing_in_and_reading_a_plug_on_tpap() -> None:
    plug = TpapPlug("192.168.0.6", "dev-heater")
    lan = Lan(plug)
    assert client(lan).request("get_device_info")["fw_ver"] == "1.4.8"
    assert client(lan).request("get_energy_usage")["current_power"] == 1_250_000  # the next poll: same session
    assert plug.logins == 1 and plug.calls == ["get_device_info", "get_energy_usage"]


def test_a_wrong_password_is_refused() -> None:
    lan = Lan(TpapPlug("192.168.0.6", "dev-heater"))
    with pytest.raises(TapoError, match="didn't accept") as e:
        client(lan, password="wrong").request("get_device_info")
    assert e.value.refused


def test_an_expired_session_is_made_again_once() -> None:
    plug = TpapPlug("192.168.0.6", "dev-heater")
    lan = Lan(plug)
    client(lan).request("get_device_info")
    plug.answer_with = -40401  # the device has let the session go
    assert client(lan).request("get_device_info")["model"] == "P110(AU)"
    assert plug.logins == 2
    plug.sessions.clear()  # it restarted
    assert client(lan).request("get_energy_usage")["today_energy"] == 900 and plug.logins == 3


def test_a_plug_that_has_stopped_accepting_sign_ins_says_so() -> None:
    plug = TpapPlug("192.168.0.6", "dev-heater")
    plug.blocked = True
    with pytest.raises(TapoError, match="stopped accepting sign-ins") as e:
        client(Lan(plug)).request("get_device_info")
    assert e.value.wait and not e.value.refused


def test_firmware_that_hashes_the_password_first() -> None:
    extra = {"type": "password_shadow", "params": {"passwd_id": 5, "passwd_prefix": "$5$rounds=1000$tapo"}}
    lan = Lan(TpapPlug("192.168.0.6", "dev-heater", extra=extra))
    assert client(lan).request("get_device_info")["device_id"] == "dev-heater"


# -- through the integration ------------------------------------------------------------------------------------
@pytest.fixture
def mixed(monkeypatch: pytest.MonkeyPatch) -> Lan:
    """One plug on TPAP (updated) and one on KLAP (not yet), as here."""
    from tests.test_tapo import Plug

    lan = Lan(TpapPlug("192.168.0.6", "dev-heater"), Plug("192.168.0.85", "dev-tv", owner=auth_hash(EMAIL, PASSWORD)))
    monkeypatch.setattr(Tapo, "post", staticmethod(lan.post))
    monkeypatch.setattr(Tapo, "finder", staticmethod(lan.find))
    return lan


def test_plugs_on_either_firmware_connect_and_read(mixed: Lan) -> None:
    saved = Tapo.sign_in({"email": EMAIL, "password": PASSWORD, "where": ""}, NET)
    assert {d: p["protocol"] for d, p in saved["plugs"].items()} == {"dev-heater": "tpap", "dev-tv": "klap"}
    readings = {r.key: r for r in Tapo(saved).poll()}
    assert readings["dev-heater"].power_w == 1250.0 and readings["dev-heater"].energy_kwh == 0.9
    assert readings["dev-heater"].name == "Heater" and readings["dev-tv"].power_w == 110.0


def test_a_plug_updated_to_tpap_is_spoken_to_that_way_after_it_is_found_again(mixed: Lan) -> None:
    from tests.test_tapo import Plug

    mixed.plugs.pop("192.168.0.6")
    mixed.plugs["192.168.0.6"] = Plug("192.168.0.6", "dev-heater", owner=auth_hash(EMAIL, PASSWORD), name="Heater")
    tapo = Tapo(Tapo.sign_in({"email": EMAIL, "password": PASSWORD, "where": ""}, NET))
    assert tapo.saved["plugs"]["dev-heater"]["protocol"] == "klap"
    mixed.plugs["192.168.0.6"] = TpapPlug("192.168.0.6", "dev-heater")  # the update
    assert {r.key: r.online for r in tapo.poll()}["dev-heater"] is False  # too soon to look again
    tapo.saved = {**tapo.saved, "found_at": 0}
    assert {r.key: r.online for r in tapo.poll()}["dev-heater"] is True
    assert tapo.saved["plugs"]["dev-heater"]["protocol"] == "tpap"


def test_a_sign_in_kept_before_tpap_asks_for_the_password_again(mixed: Lan) -> None:
    saved = Tapo.sign_in({"email": EMAIL, "password": PASSWORD, "where": ""}, NET)
    old = {k: v for k, v in saved.items() if k != "password"}  # a hash alone, as kept before
    old["plugs"] = {"dev-heater": saved["plugs"]["dev-heater"]}
    with pytest.raises(IntegrationError, match="Sign in again") as e:
        Tapo(old).poll()
    assert e.value.signed_out
