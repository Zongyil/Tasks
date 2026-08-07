const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

/**
 * Node.js Worker Thread for Electron Main Process tasks.
 * Performs file I/O, heavy JSON parsing, and background operations off the main event loop.
 */
if (parentPort) {
  parentPort.on('message', async (message) => {
    const { taskId, action, payload } = message;
    
    try {
      let result = null;
      
      switch (action) {
        case 'read-version-json': {
          const versionPath = path.join(__dirname, 'version.json');
          if (fs.existsSync(versionPath)) {
            const content = await fs.promises.readFile(versionPath, 'utf8');
            result = JSON.parse(content);
          } else {
            result = null;
          }
          break;
        }

        case 'read-file-json': {
          const targetPath = payload.filePath;
          if (fs.existsSync(targetPath)) {
            const content = await fs.promises.readFile(targetPath, 'utf8');
            result = JSON.parse(content);
          } else {
            result = null;
          }
          break;
        }

        case 'write-file-json': {
          const targetPath = payload.filePath;
          const dataStr = JSON.stringify(payload.data, null, 2);
          await fs.promises.writeFile(targetPath, dataStr, 'utf8');
          result = { success: true };
          break;
        }

        case 'parse-instance-payload': {
          // Parse command line payload off main thread
          const { commandLine, workingDirectory, additionalData } = payload;
          let protocolUrl = null;
          if (Array.isArray(commandLine)) {
            for (const arg of commandLine) {
              if (typeof arg === 'string' && arg.startsWith('tasks://')) {
                protocolUrl = arg;
                break;
              }
            }
          }
          result = {
            commandLine: commandLine || [],
            workingDirectory: workingDirectory || '',
            additionalData: additionalData || null,
            url: protocolUrl,
            timestamp: Date.now()
          };
          break;
        }

        default:
          throw new Error(`Unknown main worker action: ${action}`);
      }

      parentPort.postMessage({ taskId, success: true, result });
    } catch (error) {
      parentPort.postMessage({ taskId, success: false, error: error.message || String(error) });
    }
  });
}
