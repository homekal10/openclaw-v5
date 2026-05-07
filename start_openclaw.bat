@echo off
title OpenClaw — Auto-Restart Bot
color 0A
cd /d "C:\Users\Homekal\.antigravity\extensions\OpenClaw"
echo [%date% %time%] Starting OpenClaw watchdog... >> logs\startup.log
node watchdog.cjs >> logs\startup.log 2>&1
echo [%date% %time%] Watchdog exited, relaunching in 5s... >> logs\startup.log
timeout /t 5 /nobreak > nul
goto :relaunch
:relaunch
node watchdog.cjs >> logs\startup.log 2>&1
timeout /t 5 /nobreak > nul
goto :relaunch
