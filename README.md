# Gift Drawing

An Angular app with Firebase email/password authentication.

## Firebase setup

1. Create a Firebase project and register a web app in the Firebase console.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. Copy the Firebase web app config object into `src/environments/environment.ts`, exporting it as `firebaseConfig`. Keep the existing `export const firebaseConfig = { ... };` structure and replace its values with the values from the console; do not paste the console's `initializeApp` or Analytics setup code.
4. Add your local development host (for example, `localhost`) to **Authentication → Settings → Authorized domains** if it is not already listed.

The web app config is used by the browser and is not a service-account credential. Never put a service-account JSON key or other private server credentials in this frontend. Restrict the Firebase API key as appropriate, and configure Firebase Security Rules before storing user data.

Until the Firebase config is filled in, the app displays setup instructions instead of attempting authentication.

## Gift exchange workflow

After signing in, create an exchange and follow its **Families → Rules → Drawing** steps. Add family groups and first names, confirm the roster, then select a person to edit their relationships. Drag names into the Children, Siblings, or Spouse areas, or use the person selectors as a keyboard- and touch-friendly alternative. Children and Siblings support multiple people; Spouse supports one. Relationship selections are saved as they change. Each step has a direct exchange-specific URL, and exchange data is saved in IndexedDB in the current browser, scoped by Firebase user ID. Existing exchanges in local storage are migrated to IndexedDB on first access. This is browser-local data, not cloud sync or a backup, and it is accessible to someone with access to that browser profile. Drawing results are shown to the organizer; they are not privately delivered to participants.

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
