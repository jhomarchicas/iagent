
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentAPI', {
    models: () => ipcRenderer.invoke('agent:models'),

    start: modeloId => ipcRenderer.invoke(
        'agent:start',
        modeloId
    ),

    stop: () => ipcRenderer.invoke('agent:stop'),

    status: () => ipcRenderer.invoke('agent:status'),

    onEvent: callback => {
        const handler = (_event, data) => callback(data);

        ipcRenderer.on('agent:event', handler);

        return () => {
            ipcRenderer.removeListener(
                'agent:event',
                handler
            );
        };
    }
});
