# WSL2 端口转发配置指南

## 问题原因

WSL2 使用虚拟网络适配器，有独立的 IP 地址，Windows 宿主机无法直接访问 `localhost:5173`。

## 解决方案 1: 使用 WSL2 的 IP 地址（最快速）

### 步骤 1: 在 WSL2 中查看 IP 地址

```bash
# 在 WSL2 终端运行
hostname -I | awk '{print $1}'
```

假设输出是：`172.18.208.123`

### 步骤 2: 启动 Demo

```bash
cd /home/sorachang/projects/Genius-X
./demo-start.sh
```

### 步骤 3: 在 Windows 浏览器中访问

使用 WSL2 的 IP 地址（不是 localhost）：

```
助教端: http://172.18.208.123:5173/?role=assistant
学生端: http://172.18.208.123:5173/
```

**注意**: WSL2 的 IP 每次重启会变，需要重新查询。

---

## 解决方案 2: Windows PowerShell 端口转发（固定使用 localhost）

如果你希望在 Windows 下用 `localhost` 访问，需要配置端口转发。

### 自动转发脚本（推荐）

**以管理员身份打开 PowerShell**，然后运行：

```powershell
# 获取 WSL2 的 IP 地址
$wslIP = (wsl hostname -I).Trim().Split()[0]
Write-Host "WSL2 IP: $wslIP" -ForegroundColor Green

# 删除旧规则（如果存在）
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0
netsh interface portproxy delete v4tov4 listenport=5173 listenaddress=0.0.0.0

# 添加端口转发规则
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$wslIP
netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=$wslIP

Write-Host "Port 3000 and 5173 forwarded to WSL2" -ForegroundColor Cyan

# 添加防火墙规则（允许入站）
$rules = @(
    @{Name="WSL2-Backend-3000"; Port=3000},
    @{Name="WSL2-Frontend-5173"; Port=5173}
)

foreach ($rule in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
        New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -LocalPort $rule.Port -Protocol TCP -Action Allow | Out-Null
        Write-Host "Firewall rule added: $($rule.Name)" -ForegroundColor Green
    } else {
        Write-Host "Firewall rule already exists: $($rule.Name)" -ForegroundColor Yellow
    }
}

Write-Host "`n✅ Configuration complete!" -ForegroundColor Green
Write-Host "You can now access in Windows browser:" -ForegroundColor Cyan
Write-Host "  - Assistant: http://localhost:5173/?role=assistant" -ForegroundColor White
Write-Host "  - Student:   http://localhost:5173/" -ForegroundColor White
```

### 验证端口转发

```powershell
netsh interface portproxy show v4tov4
```

应该看到：
```
侦听 ipv4:             连接到 ipv4:
地址            端口    地址            端口
0.0.0.0         3000    172.x.x.x       3000
0.0.0.0         5173    172.x.x.x       5173
```

---

## VPN 相关问题

### 问题：TUN 模式 VPN 可能干扰本地网络

**解决方案 A：临时关闭 VPN**
- 关闭 VPN 后重新测试 `localhost:5173`

**解决方案 B：VPN 分流配置（推荐）**

在你的 VPN 客户端中配置直连规则，将本地网段排除：

```
# 常见 VPN 客户端的直连规则配置
127.0.0.0/8      # localhost
192.168.0.0/16   # 私有网段
172.16.0.0/12    # 私有网段（WSL2 通常在这里）
10.0.0.0/8       # 私有网段
```

具体配置位置：
- **Clash**：配置文件 → `rules` → 添加 `DOMAIN,localhost,DIRECT`
- **v2rayN**：设置 → 路由设置 → 添加直连规则
- **Shadowrocket**：配置 → 规则 → 添加 `IP-CIDR,172.16.0.0/12,DIRECT`

---

## 手机访问配置

### 前提条件

1. 手机和电脑在同一 WiFi
2. 已配置 Windows 端口转发（方案 2）
3. Windows 防火墙允许入站（端口转发脚本已自动配置）

### 获取 Windows WiFi IP

```powershell
# 在 Windows PowerShell 中
(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi*" | Select-Object -First 1).IPAddress
```

假设输出是 `192.168.1.100`

### 手机浏览器访问

```
助教端: http://192.168.1.100:5173/?role=assistant
学生端: http://192.168.1.100:5173/
```

---

## 完整启动流程

### 方案 1（快速测试）：直接用 WSL2 IP

```bash
# 1. 在 WSL2 中查看 IP
hostname -I | awk '{print $1}'
# 输出例如: 172.18.208.123

# 2. 启动 Demo
cd /home/sorachang/projects/Genius-X
./demo-start.sh

# 3. 在 Windows 浏览器打开
# http://172.18.208.123:5173/?role=assistant
# http://172.18.208.123:5173/
```

### 方案 2（长期使用）：配置端口转发

```powershell
# 1. 在 Windows 中以管理员身份打开 PowerShell
# 运行上面的端口转发脚本

# 2. 在 WSL2 中启动 Demo
wsl
cd /home/sorachang/projects/Genius-X
./demo-start.sh

# 3. 在 Windows 浏览器打开
# http://localhost:5173/?role=assistant
# http://localhost:5173/
```

---

## 快速验证清单

### ✅ 检查 WSL2 服务是否启动

```bash
# 在 WSL2 中
curl http://localhost:3000
curl http://localhost:5173
```

应该返回数据（不是拒绝连接）。

### ✅ 检查 Windows 端口转发（如使用方案 2）

```powershell
# 在 Windows PowerShell 中
netsh interface portproxy show v4tov4
```

应该看到 3000 和 5173 的转发规则。

### ✅ 检查防火墙规则（如使用方案 2）

```powershell
Get-NetFirewallRule -DisplayName "WSL2-*" | Select-Object DisplayName, Enabled
```

应该看到两条启用的规则。

### ✅ 测试 Windows 浏览器访问

在 Windows Chrome/Edge 打开：
```
http://localhost:5173
```

应该看到学生端加入界面（不是拒绝连接）。

---

## 常见问题排查

### ❌ Windows 访问 `localhost:5173` 仍然拒绝连接

**原因 1**：端口转发配置失败
```powershell
# 检查配置
netsh interface portproxy show v4tov4

# 如果看不到规则，重新运行端口转发脚本（管理员权限）
```

**原因 2**：WSL2 IP 地址变化
```bash
# 在 WSL2 中查看当前 IP
hostname -I

# 重新运行端口转发脚本（会自动获取新 IP）
```

**原因 3**：WSL2 服务未启动
```bash
# 在 WSL2 中检查
./demo-start.sh

# 查看日志，确认服务正常启动
```

### ❌ 手机无法访问 Windows IP

**原因 1**：防火墙阻止
```powershell
# 检查防火墙规则
Get-NetFirewallRule -DisplayName "WSL2-*"

# 手动添加规则
New-NetFirewallRule -DisplayName "WSL2-Frontend-5173" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow
```

**原因 2**：WiFi 不在同一网段
```bash
# 在手机浏览器尝试
http://192.168.1.100:5173/ping

# 如果无法访问，检查手机和电脑是否在同一 WiFi
```

**原因 3**：VPN 干扰
- 临时关闭手机或电脑的 VPN
- 或在 VPN 中配置本地网段直连

### ❌ VPN 开启后无法访问

**解决方案**：配置 VPN 分流

大多数 VPN 客户端都支持规则配置，将本地网段设为直连：

```yaml
# Clash 配置示例
rules:
  - IP-CIDR,127.0.0.0/8,DIRECT
  - IP-CIDR,172.16.0.0/12,DIRECT
  - IP-CIDR,192.168.0.0/16,DIRECT
```

如果 VPN 不支持分流，建议 Demo 时临时关闭 VPN。

---

## 推荐方案总结

| 场景 | 推荐方案 | 优点 | 缺点 |
|------|---------|------|------|
| 快速测试（仅 Windows） | 方案 1：直接用 WSL2 IP | 无需配置，立即可用 | IP 会变，每次需重新查询 |
| 长期开发（Windows + 手机） | 方案 2：端口转发 | 固定 localhost，手机可访问 | 需要管理员权限配置 |
| VPN 环境 | 配置 VPN 分流 | 不影响其他网络访问 | 需要 VPN 客户端支持 |

**我的建议**：
1. 先用方案 1 快速验证 Demo 可以运行
2. 如果需要长期使用或手机测试，再配置方案 2

---

## 需要帮助？

如果遇到问题，请提供：
1. WSL2 IP 地址（`hostname -I`）
2. Windows 端口转发配置（`netsh interface portproxy show v4tov4`）
3. 防火墙规则状态（`Get-NetFirewallRule -DisplayName "WSL2-*"`）
4. 浏览器报错信息（F12 开发者工具 → Console）
