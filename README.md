# Family Food Menu

A family meal-planning web app with a weekly/monthly recipe calendar, recipe management, and browser push notifications.

## Run locally

```bash
npm install
npm start
```

Open: http://localhost:10000

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render, create a New Web Service.
3. Connect the GitHub repository.
4. Use:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
5. Deploy.

## Enable push notifications

Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

In Render, add environment variables:

```text
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
VAPID_SUBJECT=mailto:your-email@example.com
```

Then redeploy.

## Important

Browser push notifications are delivered to the device/browser that allowed notifications. Phone numbers are stored for family records; actual SMS delivery requires an SMS provider such as Twilio.
