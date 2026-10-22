# Gift Drawing

An Angular app with Firebase email/password authentication.

## Firebase setup

1. Create a Firebase project and register a web app in the Firebase console.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. Copy the Firebase web app config object into `src/environments/environment.ts`, exporting it as `firebaseConfig`. Keep the existing `export const firebaseConfig = { ... };` structure and replace its values with the values from the console; do not paste the console's `initializeApp` or Analytics setup code.
4. Add your local development host (for example, `localhost`) to **Authentication → Settings → Authorized domains** if it is not already listed.

The web app config is used by the browser and is not a service-account credential. Never put a service-account JSON key or other private server credentials in this frontend. Restrict the Firebase API key as appropriate, and configure Firebase Security Rules before storing user data.

Until the Firebase config is filled in, the app displays setup instructions instead of attempting authentication.

## Development server

Install dependencies and start the development server:

```bash
npm install
npm start
```

Open `http://localhost:4200/`.

## Building

```bash
npm run build
```

## Tests

```bash
ng test
```
