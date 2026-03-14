@echo off
cd /d "C:\Users\Rog\claw-fleet\monitor"
node heartbeat.js --agent-id "rog" --interval 30 --status-file "C:\Users\Rog\claw-fleet\shared\fleet-status.json"
