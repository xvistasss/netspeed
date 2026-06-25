# ⚡ Premium Network Speed Test

A high-accuracy, production-grade network performance diagnostic web application built with a Vercel-inspired design language. It connects directly to Cloudflare's edge infrastructure to measure ping, jitter, download speed, upload speed, and packet loss with minimal overhead.

---

## 🧸 How It Works (For a 10-Year-Old!)

Imagine your internet connection is like a road system with tiny delivery trucks carrying letters and packages back and forth between your house (your computer) and a giant warehouse (the server). Here is how we test how good your road is:

### 1. 🏓 Ping & Jitter (The Ping-Pong Game)
*   **Ping (Reaction Time):** Imagine throwing a tennis ball at a wall and catching it when it bounces back. We measure how many milliseconds it takes for a tiny message to go to the server and come right back. A lower number means the game is super quick to react!
*   **Jitter (Steady Bounces):** If you throw the ball 10 times, and every bounce takes exactly 10 milliseconds, that's perfect! But if one bounce takes 5 milliseconds and the next takes 50 milliseconds, that's bouncy and uneven. Jitter measures how bumpy and unstable this bounce-time is.

### 2. 🚚 Download Speed (Bringing Toys Home)
Imagine ordering toys from a warehouse. Download speed measures how many delivery trucks loaded with packages can drive into your garage in one second. We open multiple lanes (parallel connections) to get as many trucks moving as possible. The more bytes we can download per second, the faster your download speed!

### 3. 📤 Upload Speed (Sending Drawings to Friends)
Now, imagine you want to mail drawings you colored to your friends. Upload speed is how many delivery trucks filled with your drawings you can send out of your garage to the warehouse in one second.

### 4. ✉️ Packet Loss (Losing Letters in the Mail)
If you send 100 letters in the mail, you expect all 100 to arrive. But if only 98 arrive and 2 get lost, that is a $2\%$ packet loss. We send a bunch of tiny packets and count how many make it safely to make sure your connection isn't losing files!

### 5. 🧑‍🔧 The Web Worker (The Invisible Super-Helper)
Testing your internet speed takes a lot of math and heavy lifting. If the website did all this math on the main screen, the screen would freeze and you wouldn't be able to click anything or see the cool animations! 
To keep the website smooth, we hire an invisible helper called a **Web Worker** ([speedtest.worker.ts](./src/speed-test/worker/speedtest.worker.ts)) to do all the heavy running and counting in a separate room in the background. The main screen just watches and displays the pretty results!

---

## 🛠️ Technology Stack

This project is built using modern web standards and high-performance libraries:

*   **Core Framework:** [Astro v7](./astro.config.mjs) (running in Server-Side Rendering (SSR) mode for dynamic endpoints and page optimization).
*   **Frontend UI Library:** [React v19](./package.json) (integrated via `@astrojs/react` to handle interactive dashboard states).
*   **Styling System:** [Tailwind CSS v4](./src/styles/global.css) utilizing Geist-inspired typography (Sans for UI/narrative, Mono for metrics & logs).
*   **Testing Engine:** A dedicated, multithreaded [Web Worker](./src/speed-test/worker/speedtest.worker.ts) using the browser `Worker` API to run tests off the main thread.
*   **Data Visualization:** [Chart.js](./package.json) for rendering real-time performance graphs and timeline charts.
*   **Hosting/Platform Adapter:** [Cloudflare Pages & Workers](./wrangler.jsonc) via the `@astrojs/cloudflare` runtime adapter.

---

## 📁 Project Structure

Here is a guide to where the important code lives:

```text
/
├── public/                  # Static assets (images, icons, manifest)
├── scripts/                 # Utility scripts (e.g. speedtest-cli.js)
├── src/                     # Core application source
│   ├── config/              # Configuration (CSP headers, etc.)
│   ├── layouts/             # Page layouts ([Layout.astro](./src/layouts/Layout.astro))
│   ├── middleware.ts        # Astro middleware for request handling
│   ├── pages/               # Routing pages ([index.astro](./src/pages/index.astro))
│   ├── speed-test/          # Core Speed Test component logic
│   │   ├── components/      # UI components (SpeedTest, DetailedMeasurements, QualityScores)
│   │   ├── hooks/           # React hooks managing testing state ([useSpeedTest.ts](./src/speed-test/hooks/useSpeedTest.ts))
│   │   ├── utils/           # Server selection and measurement algorithms
│   │   └── worker/          # Web Worker thread ([speedtest.worker.ts](./src/speed-test/worker/speedtest.worker.ts))
│   └── styles/              # Global styles ([global.css](./src/styles/global.css))
├── wrangler.jsonc           # Cloudflare deployment settings
└── package.json             # Manifest of project scripts and dependencies
```

Key speed test components:
*   [SpeedTest.tsx](./src/speed-test/components/SpeedTest.tsx): The main test interface and instrumentation controller.
*   [DetailedMeasurements.tsx](./src/speed-test/components/DetailedMeasurements.tsx): Interactive visualization of bandwidth and packet metrics.
*   [QualityScores.tsx](./src/speed-test/components/QualityScores.tsx): Real-time grading of network capability (Gaming, Video, Streaming).
*   [TechnicalLogs.tsx](./src/speed-test/components/TechnicalLogs.tsx): Terminal-like raw engine logs for network debugging.

---

## 🚀 Running Locally

Follow these steps to run the application on your computer:

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed. The project requires:
*   Node.js version `22.12.0` or higher.

### Step 1: Install Dependencies
Open your terminal in the project directory and run:
```bash
npm install
```

### Step 2: Start the Development Server
Run the following command to start a local development environment:
```bash
npm run dev
```

The terminal will print a local URL, usually **`http://localhost:4321/`**. Open this address in your web browser.

---

##  Genie Commands

All commands can be run from the terminal in the root of the project:

| Command | Action |
| :--- | :--- |
| `npm run dev` | Starts local dev server at `localhost:4321` |
| `npm run build` | Builds the production bundle (generates server code and assets) |
| `npm run preview`| Previews the production build locally before deploying |
| `npm run speedtest` | Runs a CLI-based speed test script from the command line |
| `npm run generate-types` | Generates TypeScript bindings for Cloudflare Wrangler resources |
| `npm run astro -- --help` | Shows standard Astro CLI command help options |

