# Hunter × Hunter Quiz Battle — multiplayer starter

Fan-made, unofficial 1v1 timed trivia game. Includes your approved QuizUp-inspired frontend and a real WebSocket backend. No Supabase keys or accounts needed for this first playable version.

## Requirements

Node.js 20+ and npm. Two browsers/devices for testing.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 in two different browsers or tabs. Both need different nicknames. Player one creates a room and copies its invite URL (or room code). Player two joins. Both click **Ready to play**. Play ten 10-second questions; final question scores double. Rematch requires both players to be ready again.

To test on two devices on the same Wi-Fi, use the computer's LAN IP in place of `localhost`, e.g. `http://192.168.1.50:3000`, and ensure your firewall permits the port.

## GitHub

1. Create a **new empty** repository on GitHub (no auto-generated README).
2. In this project directory run:

```bash
git init
git add .
git commit -m "Initial multiplayer quiz"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Or upload the unzipped folder contents to a new repository using GitHub's **Add file → Upload files**.

## Deploy so your friend can play remotely

Deploy as a **persistent Node.js web service** on a provider that supports WebSockets (e.g. Render Web Service or Railway). Connect your GitHub repo; select Node; build command `npm install`; start command `npm start`. The host must route HTTP and WebSocket traffic to the same server and provide the `PORT` environment variable. Share the HTTPS URL it gives you; invite links automatically use `wss://` on HTTPS.

**Do not deploy this server to Vercel serverless functions or GitHub Pages:** the WebSocket process needs an always-running server. GitHub is for source control, not multiplayer game hosting. Supabase is optional, not used in this version.

## Architecture and limitations

- `public/index.html`: existing approved layout/CSS, with online lobby controls.
- `public/client.js`: browser UI and WebSocket client.
- `server/index.cjs`: single Node process serving the site and authoritative multiplayer sessions.
- `server/questions.cjs`: question bank with correct answers kept server-side.
- Scores, countdown and question order are managed server-side. Both clients receive the same question, and rival selections are only revealed after both answer or the timer expires.
- Room tokens are stored in **tab sessionStorage** to restore a session after a brief disconnection; never share your token. Room codes/links are invitations, not passwords.
- Rooms and scores are in memory. A server restart resets matches. Run **one instance**, with no autoscaling/multiple replicas. Idle disconnected rooms are removed after 30 minutes; there are 500-room and 2 KB message limits.
- If a player disconnects mid-match the room returns to the lobby; both must press Ready to restart. The current match is discarded. For larger-scale production add persistent room storage, cross-instance coordination, authentication, abuse protection and monitoring.
- Questions are fan-made and the game is not affiliated with the QuizUp or Hunter × Hunter rights holders. Avoid using their logos or official art without permission.
