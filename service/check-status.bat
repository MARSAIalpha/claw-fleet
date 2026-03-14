@echo off
chcp 65001 >nul 2>&1
echo.
echo ========================================
echo   Claw Fleet Status Check
echo ========================================
echo.

REM 检查心跳进程
echo [1] Heartbeat Process:
wmic process where "Name='node.exe'" get CommandLine 2>nul | findstr /i "heartbeat"
if errorlevel 1 (
    echo     [WARN] No heartbeat process found!
    echo     Fix: cd %~dp0 ^&^& .\install-heartbeat-win.ps1 -AgentId "rog"
) else (
    echo     [OK] Heartbeat is running
)
echo.

REM 检查状态文件
set STATUS_FILE=%~dp0..\shared\fleet-status.json
echo [2] Status File:
if exist "%STATUS_FILE%" (
    echo     [OK] %STATUS_FILE%
    for %%F in ("%STATUS_FILE%") do echo     Size: %%~zF bytes, Modified: %%~tF
) else (
    echo     [WARN] Status file not found!
)
echo.

REM 检查 Tailscale
echo [3] Tailscale:
tailscale status >nul 2>&1
if errorlevel 1 (
    echo     [WARN] Tailscale not running
) else (
    tailscale ip -4 2>nul
    echo     [OK] Tailscale connected
)
echo.

REM 检查 OpenClaw
echo [4] OpenClaw:
where openclaw >nul 2>&1
if errorlevel 1 (
    echo     [WARN] openclaw not in PATH
) else (
    openclaw --version 2>nul
)
echo.

REM 检查启动文件夹快捷方式
echo [5] Auto-start:
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
if exist "%STARTUP%\ClawFleetHeartbeat.lnk" (
    echo     [OK] Startup shortcut exists
) else (
    echo     [WARN] No auto-start configured
)
echo.
echo ========================================
pause
