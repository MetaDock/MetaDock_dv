/**
 * SSH and remote file helpers. Used by server routes and workflow execution.
 */
const path = require('path');
const { Client } = require('ssh2');
const fs = require('fs');
const iconv = require('iconv-lite');

function escapeJsSingleQuoted(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getSshConfig() {
  return {
    host: process.env.SSH_HOST || 'localhost',
    port: parseInt(process.env.SSH_PORT || '22', 10),
    username: process.env.SSH_USER || 'root',
    password: process.env.SSH_PASSWORD || '',
    privateKey: process.env.SSH_KEY ? fs.readFileSync(process.env.SSH_KEY) : undefined
  };
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFilePermissions(mode) {
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const octal = mode.toString(8);
  const lastThree = octal.slice(-3);
  return lastThree.split('').map(n => perms[parseInt(n)]).join('');
}

function getRemoteFileList(dir, sshConfig) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const fileList = [];

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        sftp.readdir(dir, (err, list) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          const processFile = (index) => {
            if (index >= list.length) {
              conn.end();
              return resolve(fileList.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.filename.localeCompare(b.filename);
              }));
            }
            const file = list[index];
            if (file.filename.startsWith('.') ||
              file.filename === 'pagefile.sys' ||
              file.filename === 'hiberfil.sys' ||
              file.filename === 'swapfile.sys') {
              return processFile(index + 1);
            }
            const isDirectory = file.attrs.isDirectory();
            const filePath = path.posix.join(dir, file.filename);
            const safeFilePath = escapeJsSingleQuoted(filePath);
            const safeFilename = escapeJsSingleQuoted(file.filename);
            fileList.push({
              filename: file.filename,
              size: formatFileSize(file.attrs.size),
              date: new Date(file.attrs.mtime * 1000).toLocaleString(),
              permissions: getFilePermissions(file.attrs.mode),
              isDirectory,
              fullPath: filePath,
              buttons: isDirectory
                ? `<button onclick="navigateToFolder('${safeFilePath}')" class="folder-btn">Open</button>`
                : `<button onclick="selectFile('${safeFilename}')" class="file-btn">Select</button>`
            });
            processFile(index + 1);
          };
          processFile(0);
        });
      });
    }).on('error', (err) => reject(err)).connect(sshConfig);
  });
}

function readRemoteFileContent(filePath, sshConfig) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(new Error(`SFTP connection failed: ${err.message}`));
        }
        sftp.readFile(filePath, (err, data) => {
          conn.end();
          if (err) return reject(new Error(`Failed to read remote file: ${err.message}`));
          const content = data.toString('utf8');
          resolve({ content, size: data.length });
        });
      });
    }).on('error', (err) => reject(new Error(`SSH connection failed: ${err.message}`))).connect(sshConfig);
  });
}

function executeRemoteCommand(command, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        let stdout = '';
        let stderr = '';
        stream.on('close', (code) => {
          conn.end();
          if (code === 0) {
            resolve({ stdout, stderr, code });
          } else {
            reject(new Error(`Command failed with code ${code}: ${stderr}`));
          }
        }).on('data', (data) => { stdout += data.toString(); }).stderr.on('data', (data) => { stderr += data.toString(); });
      });
    }).on('error', (err) => reject(err)).connect(connectionDetails);
  });
}

async function ensureRemoteDir(dirPath, connectionDetails) {
  const safeDir = dirPath.replace(/"/g, '\\"');
  await executeRemoteCommand(`mkdir -p "${safeDir}"`, connectionDetails);
}

function uploadTextFile(remotePath, content, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        const writeStream = sftp.createWriteStream(remotePath, { encoding: 'utf8' });
        writeStream.on('close', () => { conn.end(); resolve(true); });
        writeStream.on('error', (err) => { conn.end(); reject(err); });
        writeStream.write(content);
        writeStream.end();
      });
    }).on('error', (err) => reject(err)).connect(connectionDetails);
  });
}

function downloadRemoteFile(remotePath, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        sftp.readFile(remotePath, (readErr, data) => {
          conn.end();
          if (readErr) return reject(readErr);
          resolve(data);
        });
      });
    }).on('error', (err) => reject(err)).connect(connectionDetails);
  });
}

function remoteFileExists(remotePath, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        sftp.stat(remotePath, (statErr) => {
          conn.end();
          resolve(!statErr);
        });
      });
    }).on('error', (err) => reject(err)).connect(connectionDetails);
  });
}

function findRecentPng(dirPath, sinceTs, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        sftp.readdir(dirPath, (readErr, list) => {
          conn.end();
          if (readErr) return reject(readErr);
          const threshold = sinceTs - 5000;
          const candidates = list
            .filter(f => f.filename.endsWith('.png') && f.attrs.mtime * 1000 >= threshold)
            .sort((a, b) => b.attrs.mtime - a.attrs.mtime);
          if (candidates.length === 0) return resolve(null);
          const picked = candidates[0];
          resolve({ filename: picked.filename, fullPath: path.posix.join(dirPath, picked.filename), mtime: picked.attrs.mtime * 1000 });
        });
      });
    }).on('error', (err) => reject(err)).connect(connectionDetails);
  });
}

async function getRemoteFileHead(filePath, connectionDetails, lines = 5) {
  const safePath = filePath.replace(/(["'\\])/g, '\\$1');
  const { stdout } = await executeRemoteCommand(`head -n ${lines} "${safePath}"`, connectionDetails);
  const headContent = stdout || '';
  const firstLine = headContent.split(/\r?\n/).find(Boolean) || '';
  let delimiter = ',';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes(';')) delimiter = ';';
  const cols = firstLine.split(delimiter).map(c => c.trim()).filter(Boolean);
  return { headContent, columns: cols };
}

function buildSlurmCommand(originalCommand, clusterConfig) {
  const {
    partition = 'cpu',
    clusterName = 'bioinf',
    nodes = '1',
    cpus = '24',
    memory = '64G',
    time = '06:00:00',
    ntasks = '1',
    threads = '1'
  } = clusterConfig || {};
  const slurmParams = [
    'srun', '--immediate', '--pty',
    `--partition=${partition}`, `--cluster=${clusterName}`,
    `--ntasks=${ntasks}`, `--nodes=${nodes}`, `--cpus-per-task=${cpus}`,
    `--threads-per-core=${threads}`, `--mem=${memory}`, `--time=${time}`,
    originalCommand
  ];
  return slurmParams.join(' ');
}

function executeClusterCommand(slurmCommand, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.exec(slurmCommand, (err, stream) => {
        if (err) {
          conn.end();
          return reject(new Error(`SLURM execution failed: ${err.message}`));
        }
        let output = '';
        let errorOutput = '';
        stream.on('close', (code, signal) => {
          conn.end();
          if (code === 0) resolve(output || 'Cluster job submitted successfully');
          else reject(new Error(errorOutput || output || `Job submission failed, exit code: ${code}`));
        });
        stream.on('data', (data) => { output += iconv.decode(data, 'utf-8'); });
        stream.stderr.on('data', (data) => { errorOutput += iconv.decode(data, 'utf-8'); });
      });
    });
    conn.on('error', (err) => reject(new Error(`SSH connection failed: ${err.message}`)));
    conn.connect(connectionDetails);
  });
}

module.exports = {
  getSshConfig,
  formatFileSize,
  getFilePermissions,
  getRemoteFileList,
  readRemoteFileContent,
  executeRemoteCommand,
  ensureRemoteDir,
  uploadTextFile,
  downloadRemoteFile,
  remoteFileExists,
  findRecentPng,
  getRemoteFileHead,
  buildSlurmCommand,
  executeClusterCommand
};
