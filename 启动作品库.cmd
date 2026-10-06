@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 start.py
if errorlevel 1 (
  echo 启动失败，请确认已安装 Python 3.9 或更新版本。
  pause
)
