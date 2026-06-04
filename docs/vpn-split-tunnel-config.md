# VPN 分流配置 — 本地网段直连

## 问题

全局 TUN 模式 VPN 会拦截所有流量，包括本地网络（127.0.0.1, WSL2 虚拟网段，WiFi 局域网），导致：
- Windows 无法访问 WSL2 的服务（172.x.x.x）
- 手机无法访问 Windows 的转发端口（192.168.x.x）
- Demo 演示时连接失败

## 解决方案：添加直连规则

在 VPN 客户端配置中添加以下网段的**直连规则**（不走代理）：

```yaml
# 本地回环
127.0.0.0/8

# WSL2 虚拟网段（你的是 172.23.x.x）
172.16.0.0/12

# 家庭/办公室 WiFi 局域网
192.168.0.0/16
10.0.0.0/8
```

---

## 常见 VPN 客户端配置方法

### Clash / Clash for Windows

编辑配置文件（Profiles → 编辑配置）：

```yaml
rules:
  # 本地网段直连（添加在最前面）
  - IP-CIDR,127.0.0.0/8,DIRECT
  - IP-CIDR,172.16.0.0/12,DIRECT
  - IP-CIDR,192.168.0.0/16,DIRECT
  - IP-CIDR,10.0.0.0/8,DIRECT
  
  # 原有规则...
  - MATCH,PROXY
```

保存后重载配置（Reload）。

### V2RayN / V2Ray

在"路由设置"中添加**直连规则**：

```json
{
  "routing": {
    "rules": [
      {
        "type": "field",
        "ip": ["127.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "10.0.0.0/8"],
        "outboundTag": "direct"
      }
    ]
  }
}
```

### Shadowrocket (iOS) / Surge

在"配置" → "规则"中添加：

```
IP-CIDR,127.0.0.0/8,DIRECT
IP-CIDR,172.16.0.0/12,DIRECT
IP-CIDR,192.168.0.0/16,DIRECT
IP-CIDR,10.0.0.0/8,DIRECT
```

---

## 验证分流是否生效

配置完成后，在 Windows PowerShell 中测试：

```powershell
# 1. 查看 WSL2 IP
wsl hostname -I

# 假设输出：172.23.199.0

# 2. 测试能否访问（应该返回 HTML，不是超时）
curl http://172.23.199.0:5173/

# 3. 测试后端端口
curl http://172.23.199.0:3000/
```

如果都能返回结果（不是超时），分流生效 ✅

---

## 如果 VPN 客户端不支持分流

使用 **Windows 端口转发** 作为备选方案（见 `docs/wsl2-setup.md`）。

简化版命令（以管理员身份运行 PowerShell）：

```powershell
# 获取 WSL2 IP
$wslIP = (wsl hostname -I).Trim().Split()[0]

# 转发端口 3000 和 5173
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$wslIP
netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=$wslIP

# 添加防火墙规则
New-NetFirewallRule -DisplayName "WSL2-Backend-3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "WSL2-Frontend-5173" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow

Write-Host "✅ 端口转发配置完成！"
Write-Host "现在可以用 localhost:5173 访问 Demo"
```

配置后，直接访问 `http://localhost:5173/?role=assistant`（不用 WSL2 IP）。

---

## 推荐方案

1. **优先尝试**：VPN 分流规则（一次配置，永久生效）
2. **备选方案**：Windows 端口转发（每次 WSL2 重启后需重新运行 PowerShell 脚本）

---

## 常见问题

**Q: 配置分流后，外网访问是否受影响？**  
A: 不影响。只有本地网段（127/8, 172.16/12, 192.168/16, 10/8）直连，其他流量仍走 VPN。

**Q: 手机能访问吗？**  
A: 能。手机和电脑在同一 WiFi 下（192.168.x.x），分流规则让它直连。

**Q: WSL2 开发时还能用代理吗？**  
A: 能。WSL2 内的 `http_proxy` 环境变量保持不变，开发工具（npm/pip/git）继续走代理。只是 Windows 访问 WSL2 服务时不走代理。
