# Float Todo

A beautiful floating todo app for macOS that stays on top of all windows. Features gamified meme-cat agents that roam your screen as reminders for pending tasks.

## Features

- **Always-on-top floating window** — compact Dynamic Island mode when no tasks
- **Apple-like glassmorphism** — light/dark themes with SF Pro typography
- **Meme cat agents** — 10 iconic internet cat memes (Grumpy Cat, Nyan Cat, etc.) roam your screen for pending tasks
- **Pet interactions** — cats shoot each other with angry emojis when they align
- **Task management** — add, edit, complete, comment, assign projects and pets
- **macOS notifications** — get notified when tasks change
- **Telegram integration** (optional) — sync tasks via Hermes agent for reminders from Telegram
- **Open source** — each user has their own local data

## Getting Started

### Prerequisites
- Node.js 18+
- macOS (for the floating window and notifications)

### Install & Run
```bash
git clone https://github.com/YOUR_USERNAME/float-todo.git
cd float-todo
npm install
npm start
```

### Build macOS App
```bash
npm run build
# Output: dist/Float Todo-*.dmg
```

### Install
```bash
cp -R "dist/mac-arm64/Float Todo.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/Float Todo.app"
```

## Telegram Integration (Optional)

Float Todo can sync tasks to a [Hermes](https://github.com/nousresearch/hermes-agent) agent for Telegram reminders.

1. Install and configure Hermes agent
2. Set environment variables:
   ```bash
   export HERMES_PATH=/path/to/hermes
   export HERMES_TARGET=telegram:YOUR_CHAT
   ```
3. The Hermes skill is in `~/.hermes/skills/productivity/float-todo/SKILL.md`

## Data Storage

Tasks are stored locally in:
```
~/Library/Application Support/floating-todo/todos.json
```

Each user has their own data. No shared database or server required.

## Keyboard Shortcuts

- `⌘ + ⇧ + T` — Toggle window visibility

## License

MIT
