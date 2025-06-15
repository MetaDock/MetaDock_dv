const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { Client } = require('ssh2');

const execAsync = promisify(exec);

class InstallationService {
    constructor(connectionDetails) {
        this.connectionDetails = connectionDetails;
        this.sshClient = null;
    }

    // 检查conda是否已安装
    async checkCondaInstallation() {
        try {
            const { stdout } = await execAsync('conda --version');
            console.log('Conda version:', stdout.trim());
            return { installed: true, version: stdout.trim() };
        } catch (error) {
            console.log('Conda not found:', error.message);
            return { installed: false, error: error.message };
        }
    }

    // 检查conda环境路径
    async checkCondaEnvironment(envPath = null) {
        try {
            if (envPath) {
                // 检查指定的环境路径是否存在
                const envExists = await fs.access(envPath).then(() => true).catch(() => false);
                if (!envExists) {
                    return { valid: false, error: `Conda environment path does not exist: ${envPath}` };
                }
                return { valid: true, path: envPath };
            } else {
                // 查询系统conda环境
                const { stdout } = await execAsync('conda info --envs --json');
                const envs = JSON.parse(stdout);
                const activeEnv = envs.envs.find(env => env.active);
                
                if (activeEnv) {
                    return { valid: true, path: activeEnv.prefix, name: activeEnv.name };
                } else {
                    return { valid: false, error: 'No active conda environment found' };
                }
            }
        } catch (error) {
            console.error('Error checking conda environment:', error);
            return { valid: false, error: error.message };
        }
    }

    // 检查安装路径
    async checkInstallPath(installPath = null, method = 'git') {
        try {
            if (method === 'git') {
                const targetPath = installPath || '/home';
                const pathExists = await fs.access(targetPath).then(() => true).catch(() => false);
                
                if (!pathExists) {
                    return { valid: false, error: `Installation path does not exist: ${targetPath}` };
                }
                
                // 检查写入权限
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

    // 验证安装配置
    async validateInstallationConfig(config, adminSettings = {}) {
        const validation = {
            valid: true,
            errors: [],
            warnings: [],
            condaCheck: null,
            environmentCheck: null,
            pathChecks: {}
        };

        // 检查conda安装
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

        // 检查conda环境（如果需要）
        if (validation.condaCheck.installed && (config.anaconda?.length > 0 || config.pip?.length > 0)) {
            validation.environmentCheck = await this.checkCondaEnvironment(adminSettings.condaEnvPath);
            
            if (!validation.environmentCheck.valid) {
                validation.valid = false;
                validation.errors.push(`Conda environment issue: ${validation.environmentCheck.error}`);
            }
        }

        // 检查Git安装路径
        if (config.git && config.git.length > 0) {
            validation.pathChecks.git = await this.checkInstallPath(adminSettings.gitInstallPath, 'git');
            
            if (!validation.pathChecks.git.valid) {
                validation.valid = false;
                validation.errors.push(`Git installation path issue: ${validation.pathChecks.git.error}`);
            }
        }

        return validation;
    }

    // 执行安装命令
    async executeInstallation(config, adminSettings = {}, progressCallback = null) {
        const results = {
            success: [],
            failed: [],
            logs: []
        };

        // 验证配置
        const validation = await this.validateInstallationConfig(config, adminSettings);
        if (!validation.valid) {
            results.failed.push({
                type: 'validation',
                error: 'Installation validation failed',
                details: validation.errors
            });
            return results;
        }

        // 执行conda安装
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

        // 执行pip安装
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

        // 执行git安装
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

    // Conda安装
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

    // Pip安装
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

    // Git安装
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
