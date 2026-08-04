@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AR 数据集管理器
echo 正在启动 AR 数据集管理器...
echo.
node tools\dataset-manager\server.js
if errorlevel 1 (
  echo.
  echo 启动失败：请确认电脑已安装 Node.js。
  pause
)
