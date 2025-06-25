# Testnet_Sahara_Web3

Automation script for interacting with the [Sahara Testnet](https://legends.saharalabs.ai/) using Puppeteer and Rabby Wallet.

## 🧩 Tech Stack

- [Node.js](https://nodejs.org/)
- [Puppeteer-core](https://pptr.dev/)
- [Rabby Wallet](https://rabby.io/)
- Git + GitHub

## 📂 Project Structure

.
├── Testnet_Sahara.js # Main automation script
├── core/
│ ├── helpers/
│ │ └── walletHelper.js # Rabby connection and confirmation
│ └── telegramLogger.js # Sends logs to Telegram
├── config/
│ └── profiles.json # Profiles list with WebSocket, addresses, proxy auth

## ⚙️ How to Run

1. Install dependencies:

```bash
npm install

RABBY_PASSWORD=your_wallet_password
PROFILES_PATH=./config/profiles.json

node Testnet_Sahara.js

✅ Features
Automatic "Sign In" on Sahara Testnet site

Rabby Wallet unlock and connect

Network selection and token transfers

Claiming rewards via modal task interface

Telegram log integration for each profile

🔐 Privacy
All keys, passwords, and wallet addresses are stored locally.
No data is sent to third-party services.

🚀 Roadmap
Support for additional testnets

CLI command options

Per-profile error/success reporting

Cron-based scheduled launches
