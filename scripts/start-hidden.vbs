Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Claude Code\Projects\Time Tracker"
code = sh.Run("""C:\Program Files\nodejs\node.exe"" --disable-warning=ExperimentalWarning ""C:\Claude Code\Projects\Time Tracker\server\index.js""", 0, True)
WScript.Quit code
