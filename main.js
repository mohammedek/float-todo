console.log('MAIN PROCESS STARTED');
const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

let mainWindow;
let overlayWindow;
let tray;

// Window dimensions
const EXPANDED_WIDTH = 340;
const EXPANDED_HEIGHT = 440;
const COMPACT_WIDTH = 260;
const COMPACT_HEIGHT = 48;

// Full-screen cat overlay state
let lastCats = [];
let catRects = [];
let overlayInteractive = false;
let cursorWatcher = null;
let lastNotifiedIds = '';
let fileWatcher = null;
let isWritingTodos = false;
let flashActive = false;

const dataPath = path.join(app.getPath('userData'), 'todos.json');

function loadTodos() {
  try {
    if (fs.existsSync(dataPath)) {
      return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading todos:', e);
  }
  return [];
}

function saveTodos(todos) {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(todos, null, 2));
  } catch (e) {
    console.error('Error saving todos:', e);
  }
}

function createWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: EXPANDED_WIDTH,
    height: EXPANDED_HEIGHT,
    x: screenWidth - EXPANDED_WIDTH - 20,
    y: 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'floating', 1);
  mainWindow.setFullScreenable(false);

  // Start watching for external changes (Hermes agent, Telegram)
  watchTodosFile();

  mainWindow.on('blur', () => {
    mainWindow.setOpacity(0.95);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('request-cats-sync');
  });
}

// Full-screen, transparent, click-through window where the cats roam
function createOverlayWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[overlay] did-finish-load');
    overlayWindow.webContents.send('cats-sync', lastCats);
  });

  overlayWindow.webContents.on('console-message', (event, level, message) => {
    console.log('[overlay]', message);
  });

  overlayWindow.loadFile('overlay.html');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.showInactive();

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  startCursorWatcher();
}

// Watch todos.json for external changes (e.g., from Hermes agent via Telegram)
function watchTodosFile() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  try {
    fileWatcher = fs.watch(dataPath, { persistent: true }, (eventType) => {
      if (isWritingTodos) return; // ignore our own writes
      // Debounce: notify renderer to reload
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('todos-changed');
      }
    });
  } catch (e) {
    console.error('File watch error:', e);
  }
}
function notifyPendingTasks(cats) {
  if (!Array.isArray(cats) || cats.length === 0) return;

  const ids = cats.map(c => c.id).join(',');
  if (ids === lastNotifiedIds) return; // no change
  lastNotifiedIds = ids;

  const names = cats.slice(0, 5).map(c => c.pet ? `${c.text} (${c.pet})` : c.text).join(', ');
  const body = cats.length === 1
    ? (cats[0].pet ? `${cats[0].text} — ${cats[0].pet} is waiting for you` : cats[0].text)
    : `${cats.length} pending: ${names}${cats.length > 5 ? '…' : ''}`;

  // macOS native notification — motivating, slightly uncomfortable
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: cats.length === 1 ? 'Float Todo — 1 task pending' : `Float Todo — ${cats.length} tasks pending`,
        body: cats.length === 1
          ? `Don't let "${cats[0].text}" sit there. Knock it out now.`
          : `${cats.length} tasks waiting. Pick one and start. No excuses.`,
        silent: false
      });
      n.show();
    }
  } catch (e) {
    console.error('Notification error:', e);
  }

  // Text-to-speech: "Hi Mohammed, you have N pending tasks. Please complete them quickly."
  try {
    const taskNames = cats.slice(0, 3).map(c => c.text).join(', ');
    const speechText = cats.length === 1
      ? `Hi Mohammed, you have a pending task: ${cats[0].text}. Please complete it quickly.`
      : `Hi Mohammed, you have ${cats.length} pending tasks: ${taskNames}. Please complete them quickly.`;
    exec(`say "${speechText.replace(/"/g, '\\"')}"`, { timeout: 15000 }, (err) => {
      if (err) console.error('TTS error:', err.message);
    });
  } catch (e) {
    console.error('TTS error:', e);
  }

  // Share to the Hermes agent (Telegram reminder) — optional, requires HERMES_PATH env var
  const hermes = process.env.HERMES_PATH || '';
  const hermesTarget = process.env.HERMES_TARGET || '';
  const hermesMessage = `Float Todo reminder — ${cats.length} pending task${cats.length === 1 ? '' : 's'}: ${names}. Don't let these sit. Pick one and start now.`;
  if (hermes && hermesTarget) {
    const cmd = `${hermes} send --to ${hermesTarget} ${JSON.stringify(hermesMessage)}`;
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) console.error('Hermes send error:', err.message, stderr);
    });
  }
}
// Everywhere else the overlay stays fully click-through.
function startCursorWatcher() {
  if (cursorWatcher) return;

  cursorWatcher = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) {
      setOverlayInteractive(false);
      return;
    }
    if (flashActive) {
      // Keep interactive during flash; don't override
      if (!overlayInteractive) setOverlayInteractive(true);
      return;
    }

    const point = screen.getCursorScreenPoint();
    const [winX, winY] = overlayWindow.getPosition();

    const hovering = catRects.some(rect => {
      const left = winX + rect.x;
      const top = winY + rect.y;
      return point.x >= left && point.x <= left + rect.w &&
             point.y >= top && point.y <= top + rect.h;
    });

    setOverlayInteractive(hovering);
  }, 80);
}

function setOverlayInteractive(on) {
  if (on === overlayInteractive) return;
  overlayInteractive = on;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(!on, { forward: true });
    if (!on) {
      // Reset hover state on all cats so they resume moving
      overlayWindow.webContents.send('hover-end');
    }
  }
}

function setAppVisible(visible) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (visible) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      mainWindow.hide();
    }
  }

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // Cats keep wandering 24/7 while there are pending tasks, even when
    // the main window is hidden.
    if (visible || lastCats.length > 0 || flashActive) {
      overlayWindow.showInactive();
    } else {
      overlayWindow.hide();
    }
  }
}

// Resize window from renderer
ipcMain.on('resize-window', (event, { width, height }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [currentX, currentY] = mainWindow.getPosition();
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

    // Keep right-aligned
    const newX = screenWidth - width - 20;

    mainWindow.setBounds({
      x: newX,
      y: currentY,
      width,
      height
    }, true);
  }
});

// Cats: forward pending tasks to the overlay
ipcMain.on('sync-cats', (event, cats) => {
  lastCats = Array.isArray(cats) ? cats : [];
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('cats-sync', lastCats);
  }
  notifyPendingTasks(lastCats);
});

// Cats: live hit rectangles from the overlay
ipcMain.on('cat-positions', (event, rects) => {
  catRects = Array.isArray(rects) ? rects : [];
});

// Cats: flash screen active/dismissed
ipcMain.on('flash-active', (event, active) => {
  flashActive = !!active;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (active) {
      overlayWindow.setFocusable(true);
      overlayWindow.setIgnoreMouseEvents(false, { forward: true });
      overlayWindow.showInactive();
      // Focus after a short delay
      setTimeout(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.focus();
          overlayWindow.webContents.focus();
        }
      }, 150);
    } else {
      overlayWindow.setFocusable(false);
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    overlayInteractive = active;
  }
});

ipcMain.on('flash-dismissed', (event, reason) => {
  flashActive = false;
  console.log('Flash dismissed with reason:', reason);
  // Could forward to Hermes as a log
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayInteractive = false;
  }
});

// Cats: a pet was double-clicked -> show the todo panel
ipcMain.on('show-app', () => {
  setAppVisible(true);
});

// Cats: a cat was clicked, complete its task in the main window
ipcMain.on('cat-complete', (event, id) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('complete-task', id);
  }
});

function createTray() {
  tray = new Tray(nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADFSURBVDiNpZMxDoJAEEXfLhSewITCxsYLeAMPYGHDAWw8gZ7A0ptwAhsbG09gYUFiYcIJaGyMv0AGCCyuTjLJ7sz8+TszuwH/lFjBqwEsgC2wAjJgqPO5Ep0WLoEYmABbYKzzJfCgxG2Ny6kSZzquFLwBX0qcAE8KvmmhDIjUfwQ8K/GMDnJgHxgpcQYgMADOgFPF3gAnCvaAG2CuxBmwSIGpzisB6FO9BqMQuFXiHYD0r3sNRvX3rwZ/kDQH8a3Ef+oL9RJF59d9M88AAAAASUVORK5CYII='
  ));

  tray.setToolTip('Floating Todo');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        setAppVisible(!mainWindow.isVisible());
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    setAppVisible(!mainWindow.isVisible());
  });
}

app.whenReady().then(() => {
  createWindow();
  createOverlayWindow();
  createTray();

  // Global shortcut to toggle visibility
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    setAppVisible(!mainWindow.isVisible());
  });

});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (cursorWatcher) {
    clearInterval(cursorWatcher);
    cursorWatcher = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for todo operations
ipcMain.handle('load-todos', () => {
  return loadTodos();
});

ipcMain.handle('save-todos', (event, todos) => {
  isWritingTodos = true;
  saveTodos(todos);
  // Reset flag after a short delay to allow the watcher to settle
  setTimeout(() => { isWritingTodos = false; }, 200);
  return true;
});

// Game state persistence
const gameDataPath = path.join(app.getPath('userData'), 'game.json');

ipcMain.handle('load-game', () => {
  try {
    if (fs.existsSync(gameDataPath)) {
      return JSON.parse(fs.readFileSync(gameDataPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading game:', e);
  }
  return null;
});

ipcMain.handle('save-game', (event, game) => {
  try {
    fs.writeFileSync(gameDataPath, JSON.stringify(game, null, 2));
    return true;
  } catch (e) {
    console.error('Error saving game:', e);
    return false;
  }
});

ipcMain.on('close-app', () => {
  setAppVisible(false);
});

ipcMain.on('minimize-app', () => {
  setAppVisible(false);
});
