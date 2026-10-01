"""
Sign-in for the dashboard.

One household account (username + password), created from the dashboard the first time
it's opened. Passwords are hashed with scrypt (PBKDF2 where Python lacks it); sign-ins get a random session token in an
HttpOnly cookie, and only its SHA-256 is stored. Every /api route except /api/auth/* needs
a valid session (see AuthMiddleware); /healthz and the app's static files stay open.

Forgot the password? From the install folder:
    docker compose exec wattsmypower python -m app reset-account
removes the account and every session, so the dashboard asks for a new one.
"""
