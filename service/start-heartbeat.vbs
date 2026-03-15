Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "C:\Users\Rog\claw-fleet\service\start-heartbeat.bat" & chr(34), 0, False
Set WshShell = Nothing
