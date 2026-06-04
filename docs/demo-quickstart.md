# Demo 演示快速启动指南

## 🎯 适用场景

你在 **Windows + WSL2 + 全局/TUN VPN** 环境下开发，需要在 Windows 浏览器或手机上演示 Demo。

---

## ⚡ 快速步骤（5 分钟内完成）

### 1️⃣ 配置 Windows 端口转发（一次性，10 秒）

**以管理员身份运行 PowerShell**，执行：

```powershell
cd C:\path\to\Genius-X\tools
.\wsl-port-forward.ps1
```

脚本会自动：
- 检测 WSL2 IP
- 配置端口转发（3000, 5173）
- 添加防火墙规则
- 显示访问地址

---

### 2️⃣ 在 WSL2 中启动服务

```bash
cd /home/sorachang/projects/Genius-X
./demo-start.sh
```

等待输出：
```
[server] genius-x server (mode=local) listening on http://localhost:3000
[web]   ➜  Local:   http://localhost:5173/
```

---

### 3️⃣ 打开浏览器测试

**Windows 浏览器**（3 个标签页）：
```
http://localhost:5173/?role=assistant
http://localhost:5173/
http://localhost:5173/
```

**手机浏览器**（同一 WiFi）：
```
http://192.168.x.x:5173/?role=assistant
http://192.168.x.x:5173/
```
（PowerShell 脚本会显示具体 IP）

---

## ✅ 验证连接

1. 助教端输入房间号 `test01`，点击"连接课堂"
2. 学生端输入姓名，点击"进入课堂"
3. 观察：助教端应显示"已连接 • 1 位小朋友"

如果提示"连接失败：Failed to fetch"，见下方故障排查。

---

## 🔧 故障排查

### 问题：Windows 浏览器提示"连接失败"

**原因**：VPN 拦截了本地网段流量

**解决方案 A**：配置 VPN 分流（推荐，一劳永逸）

在 VPN 客户端（Clash/V2Ray 等）添加直连规则：
```yaml
rules:
  - IP-CIDR,127.0.0.0/8,DIRECT
  - IP-CIDR,172.16.0.0/12,DIRECT      # WSL2 网段
  - IP-CIDR,192.168.0.0/16,DIRECT     # WiFi 局域网
```

详见 [`docs/vpn-split-tunnel-config.md`](../docs/vpn-split-tunnel-config.md)

**解决方案 B**：重启端口转发

WSL2 重启后 IP 会变，需重新运行 `wsl-port-forward.ps1`。

---

### 问题：手机无法访问

1. **检查防火墙**：PowerShell 脚本已添加规则，若仍阻止可手动关闭 Windows 防火墙测试
2. **检查 VPN**：确保 VPN 分流规则包含 `192.168.0.0/16`
3. **检查 WiFi**：手机和电脑必须在同一 WiFi 下

---

## 📚 完整文档

- 演示脚本：[`docs/demo-live-guide.md`](../docs/demo-live-guide.md)
- WSL2 网络配置：[`docs/wsl2-setup.md`](../docs/wsl2-setup.md)
- VPN 分流配置：[`docs/vpn-split-tunnel-config.md`](../docs/vpn-split-tunnel-config.md)

---

## 💡 开发提示

保持 WSL2 的 `http_proxy` 环境变量不变（用于开发工具走代理）。

端口转发只影响 Windows → WSL2 的访问，不影响 WSL2 内部的开发环境。
