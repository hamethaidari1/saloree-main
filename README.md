# Pixel Perfect Replica (11)

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/82abead7-1466-4364-93e0-bca2c6f74beb).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Store traffic (seller analytics)

Storefront pages send one anonymous page view to `POST /api/track` (store id only).
The server turns the visitor's IP address and browser into a one-way daily hash
and never stores or logs either of them. No cookies, no browser storage, no
third-party analytics; visitors with Do Not Track or Global Privacy Control
are not counted, nor are bots, the store's owner or staff.

It needs one **server-only** environment variable:

| Variable     | Value                                               | Where                                                                |
| ------------ | --------------------------------------------------- | -------------------------------------------------------------------- |
| `TRACK_SALT` | Any long random string, e.g. `openssl rand -hex 32` | Hosting environment variables (e.g. Vercel). Never `VITE_`-prefixed. |

Without `TRACK_SALT` nothing is recorded (one warning is logged). The database
functions `record_store_visit` and `store_traffic_summary` are applied separately.
