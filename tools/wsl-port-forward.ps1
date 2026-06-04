# Windows 端口转发脚本（自动化）

## 快速使用

**以管理员身份运行 PowerShell**，然后执行以下脚本：

```powershell
# 保存为 wsl-port-forward.ps1

# 检查管理员权限
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Warning "需要管理员权限！请右键 PowerShell → 以管理员身份运行"
    exit 1
}

Write-Host "🔧 配置 WSL2 端口转发（用于 Genius X Demo）" -ForegroundColor Cyan
Write-Host ""

# 获取 WSL2 IP
Write-Host "📍 获取 WSL2 IP..." -ForegroundColor Yellow
$wslIP = (wsl hostname -I).Trim().Split()[0]

if (-not $wslIP) {
    Write-Error "无法获取 WSL2 IP，请确保 WSL2 正在运行"
    exit 1
}

Write-Host "   WSL2 IP: $wslIP" -ForegroundColor Green
Write-Host ""

# 清理旧规则（避免重复）
Write-Host "🧹 清理旧的端口转发规则..." -ForegroundColor Yellow
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0 2>$null
netsh interface portproxy delete v4tov4 listenport=5173 listenaddress=0.0.0.0 2>$null

# 添加新规则
Write-Host "➕ 添加端口转发规则..." -ForegroundColor Yellow
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$wslIP
netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=$wslIP

Write-Host "   Windows :3000 → WSL2 $wslIP:3000" -ForegroundColor Green
Write-Host "   Windows :5173 → WSL2 $wslIP:5173" -ForegroundColor Green
Write-Host ""

# 配置防火墙（允许入站）
Write-Host "🛡️  配置防火墙规则..." -ForegroundColor Yellow

# 删除旧规则（如果存在）
Remove-NetFirewallRule -DisplayName "WSL2-Genius-Backend-3000" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "WSL2-Genius-Frontend-5173" -ErrorAction SilentlyContinue

# 添加新规则
New-NetFirewallRule -DisplayName "WSL2-Genius-Backend-3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow | Out-Null
New-NetFirewallRule -DisplayName "WSL2-Genius-Frontend-5173" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow | Out-Null

Write-Host "   允许端口 3000, 5173 入站" -ForegroundColor Green
Write-Host ""

# 显示当前规则
Write-Host "📋 当前端口转发规则：" -ForegroundColor Cyan
netsh interface portproxy show v4tov4
Write-Host ""

Write-Host "✅ 配置完成！" -ForegroundColor Green
Write-Host ""
Write-Host "🎯 现在可以在 Windows 浏览器访问：" -ForegroundColor Cyan
Write-Host "   • http://localhost:5173/?role=assistant" -ForegroundColor White
Write-Host "   • http://localhost:5173/" -ForegroundColor White
Write-Host ""

# 获取 Windows 本机 WiFi IP（用于手机访问）
$windowsIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -like "*Wi-Fi*" -or $_.InterfaceAlias -like "*以太网*" } | Select-Object -First 1).IPAddress

if ($windowsIP) {
    Write-Host "📱 手机访问（同一 WiFi 下）：" -ForegroundColor Cyan
    Write-Host "   • http://${windowsIP}:5173/?role=assistant" -ForegroundColor White
    Write-Host "   • http://${windowsIP}:5173/" -ForegroundColor White
    Write-Host ""
}

Write-Host "💡 提示：" -ForegroundColor Yellow
Write-Host "   • 每次 WSL2 重启后需重新运行此脚本（WSL2 IP 会变）" -ForegroundColor Gray
Write-Host "   • VPN 开启时，确保本地网段（192.168.x.x）直连" -ForegroundColor Gray
Write-Host ""
