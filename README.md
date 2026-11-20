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

After signing in, create an exchange and follow its **Families → Rules → Drawing** steps. Add family groups and first names, confirm the roster, then select a person to edit their relationships. Drag names into the Children, Siblings, or Spouse areas, or use the person selectors as a keyboard- and touch-friendly alternative. Children and Siblings support multiple people; Spouse supports one. Relationship selections are saved as they change. By default, drawings prevent parent-to-child and child-to-parent assignments, sibling matches, and spouse matches; these rules can be adjusted on the Rules step. Family grouping is used for organizing the roster, not for restricting matches. Each step has a direct exchange-specific URL, and exchange data is saved in IndexedDB in the current browser, scoped by Firebase user ID. Existing exchanges in local storage are migrated to IndexedDB on first access. This is browser-local data, not cloud sync or a backup, and it is accessible to someone with access to that browser profile. Drawing results are shown to the organizer; they are not privately delivered to participants.

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

## GitHub Actions deployment

`.github/workflows/deploy.yml` runs when a commit is pushed to `main` (including merge commits). It installs dependencies, runs the frontend tests and production build, applies the Terraform website configuration, and syncs `dist/gift_drawing_app/browser/` to S3.

The workflow uses GitHub OIDC to assume an AWS IAM role; do not add long-lived AWS access keys to GitHub. Configure these repository **Actions variables**:

- `AWS_REGION`: region for the website and Terraform state buckets.
- `AWS_ROLE_ARN`: IAM role ARN trusted for this repository's `main` branch through GitHub OIDC.
- `S3_BUCKET_NAME`: globally unique name for the public website bucket.
- `TF_STATE_BUCKET`: name of a separate, pre-created private S3 bucket for Terraform state. Enable versioning on it; the workflow uses S3 lock files.

Create the Terraform state bucket before the first deployment. Configure the AWS role's OIDC trust policy to allow `repo:davidmoen810/gift_drawing_app:ref:refs/heads/main`, and grant it permission to manage the website bucket, read and publish its objects, and read/write/lock the Terraform state in `TF_STATE_BUCKET`. The account must allow public S3 bucket policies for the website bucket.

The deployment role needs `s3:ListBucket`, `s3:GetBucketLocation`, `s3:CreateBucket`, `s3:GetBucketWebsite`, `s3:PutBucketWebsite`, `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `s3:GetBucketOwnershipControls`, `s3:PutBucketOwnershipControls`, `s3:GetBucketPolicy`, `s3:PutBucketPolicy`, `s3:PutObject`, and `s3:DeleteObject` for the website bucket. For the state bucket, it needs `s3:ListBucket` and `s3:GetBucketLocation` on the bucket, plus `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on its objects (including the `.tflock` lock file).

Terraform enables S3 website hosting and public object reads. The URL uses the S3 website endpoint over **HTTP only**. Add the website hostname to Firebase **Authentication → Settings → Authorized domains**. S3 static website hosting does not provide HTTPS; use CloudFront in front of the bucket if HTTPS or a custom domain is needed. The workflow synchronizes with `--delete`, so use a dedicated website bucket.
