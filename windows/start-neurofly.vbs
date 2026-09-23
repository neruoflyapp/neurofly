Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set env = WshShell.Environment("PROCESS")
env("PATH") = "C:\Program Files\nodejs\;" & env("PATH")
WshShell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run """C:\Program Files\nodejs\npm.cmd"" start", 0, False
