
require('dotenv').config();

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Agent } = require('./agent');

let ventana;

const agente = new Agent((evento, datos) => {
    if (ventana && !ventana.isDestroyed()) {
        ventana.webContents.send('agent:event', {
            event: evento,
            payload: datos
        });
    }
});

function crearVentana() {
    ventana = new BrowserWindow({
        width: 1160,
        height: 790,
        minWidth: 780,
        minHeight: 570,
        backgroundColor: '#0b1220',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    ventana.loadFile(
        path.join(__dirname, 'interfaz', 'index.html')
    );
}

app.whenReady().then(() => {
    agente.setProfileDir(
        path.join(app.getPath('userData'), 'perfil-chrome')
    );

    ipcMain.handle('agent:models', () => agente.models());

    ipcMain.handle('agent:start', (_evento, modeloId) => {
        return agente.start(modeloId);
    });

    ipcMain.handle('agent:stop', () => agente.stop());

    ipcMain.handle('agent:status', () => agente.status());

    crearVentana();
});

app.on('before-quit', () => {
    agente.stop();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        crearVentana();
    }
});
