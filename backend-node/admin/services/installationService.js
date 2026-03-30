const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { Client } = require('ssh2');

const execAsync = promisify(exec);

const CHECK_TIMEOUT_MS = 15000;

function execWithTimeout(command, timeoutMs = CHECK_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const child = exec(command, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) return reject(err);
            resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
        child.on('error', reject);
    });
}

function withTimeout(promise, ms, message = 'Operation timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
    ]);
}

class InstallationService {
    constructor(connectionDetails) {
        this.connectionDetails = connectionDetails;
        this.sshClient = null;
    }

    async _execRemote(command) {
        const sshHelpers = require('../../lib/sshHelpers');
        const result = await withTimeout(
            sshHelpers.executeRemoteCommand(command, this.connectionDetails),
            20000,
            'Remote check timed out (20s)'
        );
        return result.stdout || '';
    }

    // check if conda is installed (remote via SSH if connected, else local with timeout)
    async checkCondaInstallation() {
        try {
            if (this.connectionDetails) {
                const condaPath = process.env.CONDA_PATH || '$HOME/miniconda3';
                const cmd = `source ~/.bashrc 2>/dev/null || true; export PATH="${condaPath}/bin:$PATH"; conda --version 2>/dev/null || echo "conda not found"`;
                const stdout = await this._execRemote(cmd);
                const version = (stdout || '').trim();
                if (version && version !== 'conda not found' && !version.toLowerCase().includes('not found')) {
                    console.log('Conda version (remote):', version);
                    return { installed: true, version };
                }
                return { installed: false, error: version || 'Conda not found on remote' };
            }
            const { stdout } = await execWithTimeout('conda --version');
            console.log('Conda version (local):', (stdout || '').trim());
            const version = (stdout || '').trim();
            if (version) return { installed: true, version };
            return { installed: false, error: 'Conda not in PATH' };
        } catch (error) {
            const msg = error.killed === true ? 'Conda check timed out' : (error.message || String(error));
            console.log('Conda not found:', msg);
            return { installed: false, error: msg };
        }
    }

    // check conda environment path (remote via SSH if connected, else local with timeout)
    async checkCondaEnvironment(envPath = null) {
        try {
            if (envPath && !this.connectionDetails) {
                const envExists = await fs.access(envPath).then(() => true).catch(() => false);
                if (!envExists) {
                    return { valid: false, error: `Conda environment path does not exist: ${envPath}` };
                }
                return { valid: true, path: envPath };
            }
            if (this.connectionDetails) {
                const condaPath = process.env.CONDA_PATH || '$HOME/miniconda3';
                const cmd = envPath
                    ? `( test -d "${envPath}" && echo ok ) || echo no`
                    : `source ~/.bashrc 2>/dev/null || true; export PATH="${condaPath}/bin:$PATH"; conda info --envs --json 2>/dev/null || echo '{"envs":[]}'`;
                const stdout = await this._execRemote(cmd);
                if (envPath) {
                    if ((stdout || '').trim() === 'ok') return { valid: true, path: envPath };
                    return { valid: false, error: `Path does not exist on remote: ${envPath}` };
                }
                const envs = JSON.parse(stdout || '{}');
                const list = envs.envs || [];
                const activeEnv = list.find(e => e.active);
                if (activeEnv) return { valid: true, path: activeEnv.prefix, name: activeEnv.name };
                if (list.length > 0) return { valid: true, path: list[0].prefix, name: list[0].name };
                return { valid: false, error: 'No conda environment found on remote' };
            }
            const { stdout } = await execWithTimeout('conda info --envs --json');
            const envs = JSON.parse(stdout || '{}');
            const list = envs.envs || [];
            const activeEnv = list.find(env => env.active);
            if (activeEnv) return { valid: true, path: activeEnv.prefix, name: activeEnv.name };
            if (list.length > 0) return { valid: true, path: list[0].prefix, name: list[0].name };
            return { valid: false, error: 'No active conda environment found' };
        } catch (error) {
            const msg = error.killed === true ? 'Environment check timed out' : (error.message || String(error));
            console.error('Error checking conda environment:', msg);
            return { valid: false, error: msg };
        }
    }

    // check installation path
    async checkInstallPath(installPath = null, method = 'git') {
        try {
            if (method === 'git') {
                const targetPath = installPath || '/home';
                const pathExists = await fs.access(targetPath).then(() => true).catch(() => false);
                
                if (!pathExists) {
                    return { valid: false, error: `Installation path does not exist: ${targetPath}` };
                }
                
                // check write permission
                try {
                    await fs.access(targetPath, fs.constants.W_OK);
                    return { valid: true, path: targetPath };
                } catch (error) {
                    return { valid: false, error: `No write permission for path: ${targetPath}` };
                }
            }
            
            return { valid: true, path: installPath || '/home' };
        } catch (error) {
            console.error('Error checking install path:', error);
            return { valid: false, error: error.message };
        }
    }

    // validate installation config
    async validateInstallationConfig(config, adminSettings = {}) {
        const validation = {
            valid: true,
            errors: [],
            warnings: [],
            condaCheck: null,
            environmentCheck: null,
            pathChecks: {}
        };

        // check conda installation
        validation.condaCheck = await this.checkCondaInstallation();
        
        if (!validation.condaCheck.installed) {
            if (config.anaconda && config.anaconda.length > 0) {
                validation.valid = false;
                validation.errors.push('Conda is not installed but Anaconda installation is requested');
            }
            if (config.pip && config.pip.length > 0) {
                validation.valid = false;
                validation.errors.push('Conda is not installed but Pip installation is requested');
            }
        }

        // check conda environment (if needed)
        if (validation.condaCheck.installed && (config.anaconda?.length > 0 || config.pip?.length > 0)) {
            validation.environmentCheck = await this.checkCondaEnvironment(adminSettings.condaEnvPath);
            
            if (!validation.environmentCheck.valid) {
                validation.valid = false;
                validation.errors.push(`Conda environment issue: ${validation.environmentCheck.error}`);
            }
        }

        // check Git installation path
        if (config.git && config.git.length > 0) {
            validation.pathChecks.git = await this.checkInstallPath(adminSettings.gitInstallPath, 'git');
            
            if (!validation.pathChecks.git.valid) {
                validation.valid = false;
                validation.errors.push(`Git installation path issue: ${validation.pathChecks.git.error}`);
            }
        }

        return validation;
    }

    // execute installation command
    async executeInstallation(config, adminSettings = {}, progressCallback = null) {
        const results = {
            success: [],
            failed: [],
            logs: []
        };

        // validate config
        const validation = await this.validateInstallationConfig(config, adminSettings);
        if (!validation.valid) {
            results.failed.push({
                type: 'validation',
                error: 'Installation validation failed',
                details: validation.errors
            });
            return results;
        }

        // execute conda installation
        if (config.anaconda && config.anaconda.length > 0) {
            for (const tool of config.anaconda) {
                try {
                    const result = await this.installViaConda(tool, adminSettings, progressCallback);
                    if (result.success) {
                        results.success.push(result);
                    } else {
                        results.failed.push(result);
                    }
                } catch (error) {
                    results.failed.push({
                        tool: tool.name || tool.id,
                        method: 'anaconda',
                        error: error.message
                    });
                }
            }
        }

        // execute pip installation
        if (config.pip && config.pip.length > 0) {
            for (const tool of config.pip) {
                try {
                    const result = await this.installViaPip(tool, adminSettings, progressCallback);
                    if (result.success) {
                        results.success.push(result);
                    } else {
                        results.failed.push(result);
                    }
                } catch (error) {
                    results.failed.push({
                        tool: tool.name || tool.id,
                        method: 'pip',
                        error: error.message
                    });
                }
            }
        }

        // execute git installation
        if (config.git && config.git.length > 0) {
            for (const tool of config.git) {
                try {
                    const result = await this.installViaGit(tool, adminSettings, progressCallback);
                    if (result.success) {
                        results.success.push(result);
                    } else {
                        results.failed.push(result);
                    }
                } catch (error) {
                    results.failed.push({
                        tool: tool.name || tool.id,
                        method: 'git',
                        error: error.message
                    });
                }
            }
        }

        return results;
    }

    // conda installation
    async installViaConda(tool, adminSettings, progressCallback) {
        const command = tool.installCommands?.anaconda;
        if (!command) {
            return {
                success: false,
                tool: tool.name || tool.id,
                method: 'anaconda',
                error: 'No conda installation command found'
            };
        }

        if (progressCallback) {
            progressCallback(`Installing ${tool.name} via conda...`, 'installing');
        }

        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: adminSettings.condaEnvPath || process.cwd()
            });

            if (progressCallback) {
                progressCallback(`✓ ${tool.name} installed successfully via conda`, 'success');
            }

            return {
                success: true,
                tool: tool.name || tool.id,
                method: 'anaconda',
                output: stdout,
                error: stderr
            };
        } catch (error) {
            if (progressCallback) {
                progressCallback(`✗ Failed to install ${tool.name} via conda: ${error.message}`, 'error');
            }

            return {
                success: false,
                tool: tool.name || tool.id,
                method: 'anaconda',
                error: error.message,
                output: error.stdout,
                stderr: error.stderr
            };
        }
    }

    // pip installation
    async installViaPip(tool, adminSettings, progressCallback) {
        const command = tool.installCommands?.pip;
        if (!command) {
            return {
                success: false,
                tool: tool.name || tool.id,
                method: 'pip',
                error: 'No pip installation command found'
            };
        }

        if (progressCallback) {
            progressCallback(`Installing ${tool.name} via pip...`, 'installing');
        }

        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: adminSettings.condaEnvPath || process.cwd()
            });

            if (progressCallback) {
                progressCallback(`✓ ${tool.name} installed successfully via pip`, 'success');
            }

            return {
                success: true,
                tool: tool.name || tool.id,
                method: 'pip',
                output: stdout,
                error: stderr
            };
        } catch (error) {
            if (progressCallback) {
                progressCallback(`✗ Failed to install ${tool.name} via pip: ${error.message}`, 'error');
            }

            return {
                success: false,
                tool: tool.name || tool.id,
                method: 'pip',
                error: error.message,
                output: error.stdout,
                stderr: error.stderr
            };
        }
    }

    // git installation
    async installViaGit(tool, adminSettings, progressCallback) {
        const command = tool.installCommands?.git;
        if (!command) {
            return {
                success: false,
                tool: tool.name || tool.id,
                method: 'git',
                error: 'No git installation command found'
            };
        }

        const installPath = adminSettings.gitInstallPath || '/home';

        if (progressCallback) {
            progressCallback(`Installing ${tool.name} via git to ${installPath}...`, 'installing');
        }

        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: installPath
            });

            if (progressCallback) {
                progressCallback(`✓ ${tool.name} installed successfully via git`, 'success');
            }

            return {
                success: true,
                tool: tool.name || tool.id,
                method: 'git',
                output: stdout,
                error: stderr,
                installPath: installPath
            };
        } catch (error) {
            if (progressCallback) {
                progressCallback(`✗ Failed to install ${tool.name} via git: ${error.message}`, 'error');
            }

            return {
                success: false,
                tool: tool.name || tool.id,
                method: 'git',
                error: error.message,
                output: error.stdout,
                stderr: error.stderr,
                installPath: installPath
            };
        }
    }
}

module.exports = InstallationService;
