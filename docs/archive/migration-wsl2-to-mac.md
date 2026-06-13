# WSL2 → Mac 迁移计划

**迁移时机**: Demo 演示完成后  
**目标环境**: macOS (开发机)  
**迁移策略**: 完整项目迁移 + 环境重建 + 验证清单

---

## 📋 迁移前准备（在 WSL2 上）

### 1. 确保代码完全提交

```bash
cd /home/sorachang/projects/Genius-X

# 检查是否有未提交的修改
git status

# 如果有修改，提交它们
git add -A
git commit -m "chore: pre-migration checkpoint"

# 推送到远程仓库（重要！）
git push origin main
git push origin --all  # 推送所有分支
```

**检查清单：**
- [ ] `git status` 显示 "working tree clean"
- [ ] 所有分支都已推送到远程
- [ ] 远程仓库可以正常访问（GitHub / GitLab / Gitee）

---

### 2. 导出环境配置

```bash
# 导出 Node.js 版本
node --version > ~/genius-x-env.txt
pnpm --version >> ~/genius-x-env.txt

# 导出全局依赖（如果有）
pnpm list -g --depth=0 >> ~/genius-x-env.txt

# 导出系统信息
uname -a >> ~/genius-x-env.txt
```

**保存文件位置**: `~/genius-x-env.txt`（可以通过 `\\wsl.localhost\Ubuntu\home\sorachang\genius-x-env.txt` 从 Windows 访问）

---

### 3. 备份重要数据（可选）

如果有本地测试数据、配置文件、笔记等：

```bash
# 创建备份目录
mkdir -p ~/genius-x-backup

# 复制重要文件（示例）
cp -r ~/projects/Genius-X/.env* ~/genius-x-backup/ 2>/dev/null || echo "No .env files"
cp ~/projects/Genius-X/notes.md ~/genius-x-backup/ 2>/dev/null || echo "No notes"

# 打包备份
cd ~
tar -czf genius-x-backup.tar.gz genius-x-backup/
```

**传输备份到 Mac**:
- 方法 A: 通过 U 盘
- 方法 B: 上传到云盘（Google Drive / OneDrive）
- 方法 C: 通过局域网 `scp` 传输

---

## 🚀 Mac 上的迁移步骤

### Step 1: 安装开发环境

#### 1.1 安装 Homebrew（如果没有）

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### 1.2 安装 Node.js

```bash
# 安装 nvm（Node Version Manager，推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 重启终端，然后安装 Node.js（使用 WSL2 相同版本）
nvm install 22  # 根据 genius-x-env.txt 调整版本
nvm use 22
nvm alias default 22
```

#### 1.3 安装 pnpm

```bash
npm install -g pnpm
```

#### 1.4 安装 Git（通常 macOS 已预装）

```bash
git --version
# 如果没有，运行：brew install git
```

---

### Step 2: 克隆项目

#### 2.1 配置 Git SSH（如果使用 SSH 克隆）

```bash
# 生成 SSH 密钥（如果没有）
ssh-keygen -t ed25519 -C "your_email@example.com"

# 复制公钥
cat ~/.ssh/id_ed25519.pub

# 添加到 GitHub / GitLab 的 SSH Keys 设置
```

#### 2.2 克隆仓库

```bash
# 创建项目目录
mkdir -p ~/projects
cd ~/projects

# 克隆仓库（根据实际情况选择 HTTPS 或 SSH）
git clone git@github.com:your-username/Genius-X.git
# 或者：git clone https://github.com/your-username/Genius-X.git

cd Genius-X
```

---

### Step 3: 安装依赖

```bash
cd ~/projects/Genius-X

# 安装所有依赖（Monorepo）
pnpm install
```

**预计时间**: 2-5 分钟（取决于网络速度）

**可能的问题：**
- **网络慢**: 配置 npm 镜像源（淘宝镜像）
  ```bash
  pnpm config set registry https://registry.npmmirror.com
  ```
- **权限错误**: 检查目录权限 `ls -la ~/projects/`

---

### Step 4: 验证环境

#### 4.1 TypeScript 编译检查

```bash
pnpm typecheck
```

**预期输出**: `✅ Typecheck passed` 或类似无错误信息

#### 4.2 运行测试

```bash
pnpm test
```

**预期**: 所有单元测试通过

#### 4.3 启动服务

```bash
# 方法 A: 使用 demo 启动脚本
./demo-start.sh

# 方法 B: 分别启动（两个终端）
# 终端 1
cd apps/server
pnpm dev

# 终端 2
cd apps/web
pnpm dev
```

**预期输出**:
```
[server] genius-x server (mode=local) listening on http://localhost:3000
[web]   ➜  Local:   http://localhost:5173/
```

#### 4.4 浏览器测试

打开浏览器访问：
```
http://localhost:5173/?role=assistant
http://localhost:5173/
```

**验证清单：**
- [ ] 前端页面正常加载
- [ ] 助教端可以创建课堂
- [ ] 学生端可以加入课堂
- [ ] Canvas 涂鸦正常工作
- [ ] 麦克风权限请求正常（需点击允许）

---

## 🔧 Mac 特定配置

### 1. 网络配置（无需 WSL2 端口转发）

**好消息**: Mac 上不需要 Windows 端口转发！

- ✅ `localhost:3000` 和 `localhost:5173` 直接可用
- ✅ 不需要 VPN 分流配置
- ✅ 同一 WiFi 下的设备可以通过 Mac IP 访问

**手机/iPad 测试**:
```bash
# 查看 Mac 的本地 IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# 假设输出: 192.168.1.100
# 手机访问: http://192.168.1.100:5173/
```

---

### 2. 开发工具推荐（可选）

**IDE / 编辑器：**
- VS Code: `brew install --cask visual-studio-code`
- Cursor: `brew install --cask cursor`

**终端工具：**
- iTerm2: `brew install --cask iterm2`（比默认 Terminal 更强大）
- Oh My Zsh: 美化和增强 Zsh（macOS 默认 shell）

**Git GUI（可选）：**
- GitKraken: `brew install --cask gitkraken`
- Sourcetree: `brew install --cask sourcetree`

---

### 3. 配置 Claude Code（如果使用）

```bash
# 安装 Claude Code CLI（根据实际版本）
# 参考: https://claude.ai/code

# 配置项目
cd ~/projects/Genius-X
claude code init
```

---

## 📝 迁移后的工作流

### 日常开发

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 安装新依赖（如果 package.json 有更新）
pnpm install

# 3. 启动开发服务器
./demo-start.sh

# 4. 开发...

# 5. 提交代码
git add -A
git commit -m "feat: your feature"
git push origin main
```

---

### 分支管理

```bash
# 创建新分支
git checkout -b feature/your-feature

# 开发...

# 推送分支
git push origin feature/your-feature

# 合并到 main（在 GitHub 上创建 PR，或本地合并）
git checkout main
git pull origin main
git merge feature/your-feature
git push origin main
```

---

### 多人协作（如果有团队）

**推荐 Git 工作流：**
1. 从 `main` 分支创建功能分支
2. 在功能分支上开发
3. 推送到远程，创建 Pull Request
4. Code Review 后合并到 `main`

**协作注意事项：**
- 合约 (`@genius-x/contracts`) 修改需要团队协商
- 大的重构在独立分支完成，避免阻塞其他人
- 遵循 `AGENTS.md` 中的协作规则

---

## 🐛 常见问题

### 问题 1: `pnpm install` 失败

**症状**: "ENOENT: no such file or directory"

**解决方案:**
```bash
# 清理缓存
pnpm store prune

# 删除 node_modules 和 lockfile
rm -rf node_modules pnpm-lock.yaml

# 重新安装
pnpm install
```

---

### 问题 2: 端口被占用

**症状**: "Error: listen EADDRINUSE :::3000"

**解决方案:**
```bash
# 查找占用端口的进程
lsof -i :3000

# 杀掉进程（替换 PID）
kill -9 <PID>
```

---

### 问题 3: TypeScript 编译错误

**症状**: 迁移后出现新的类型错误

**可能原因**: Node.js / TypeScript 版本不一致

**解决方案:**
```bash
# 检查版本
node --version
pnpm list typescript

# 安装指定版本（参考 WSL2 的 genius-x-env.txt）
pnpm add -D typescript@5.x.x
```

---

### 问题 4: 麦克风/Canvas 不工作

**原因**: macOS 需要浏览器权限

**解决方案:**
1. 打开"系统设置" → "隐私与安全性"
2. 找到"麦克风" / "相机"
3. 允许浏览器（Chrome / Safari）访问

---

## ✅ 迁移验证清单

完成以下检查后，迁移即为成功：

### 环境验证
- [ ] Node.js 和 pnpm 版本正确
- [ ] Git 可以正常 pull/push
- [ ] `pnpm install` 无错误
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过

### 功能验证
- [ ] 后端服务正常启动（localhost:3000）
- [ ] 前端服务正常启动（localhost:5173）
- [ ] 助教端可以创建课堂
- [ ] 学生端可以加入课堂
- [ ] Canvas 涂鸦功能正常
- [ ] 麦克风录音功能正常（需授权）
- [ ] 完整流程可以跑通（intro → closure）

### 开发工具验证
- [ ] IDE 可以正常打开项目
- [ ] Git 分支管理正常
- [ ] 可以提交和推送代码

---

## 📊 迁移时间估算

| 步骤 | 预计时间 |
|------|---------|
| 安装开发环境（Homebrew, Node.js, pnpm） | 15-30 分钟 |
| 克隆项目 + 安装依赖 | 5-10 分钟 |
| 验证和测试 | 10-15 分钟 |
| 配置开发工具（可选） | 15-30 分钟 |
| **总计** | **45-85 分钟** |

**建议**: 选择网络环境好的时间段进行迁移。

---

## 🎯 迁移后的优势

相比 WSL2 + Windows 环境，Mac 开发的优势：

✅ **无需端口转发**: localhost 直接可用  
✅ **无 VPN 干扰**: 本地网络配置简单  
✅ **Unix 原生环境**: 与生产环境一致  
✅ **性能更好**: 无虚拟化开销  
✅ **工具链更成熟**: Homebrew 生态强大  

---

## 📞 迁移支持

如果迁移过程中遇到问题：

1. **检查错误日志**: 复制完整的错误信息
2. **查阅文档**: `docs/` 目录和 `README.md`
3. **回滚方案**: WSL2 环境仍然可用，可以随时切回
4. **联系支持**: 将错误信息和环境信息（`node --version`, `pnpm --version`）提供给技术支持

---

**祝迁移顺利！🚀**
