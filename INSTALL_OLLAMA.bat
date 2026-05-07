@echo off
echo ====================================================
echo OLLAMA AUTOMATED INSTALLER - OPENCLAW DIGITAL TWIN
echo ====================================================
echo.
echo Killing any existing Ollama processes...
taskkill /F /IM "OllamaSetup*" >nul 2>&1
taskkill /F /IM "Ollama*" >nul 2>&1
echo.
echo Downloading installer to Downloads folder to avoid permission issues...
echo This might take a few minutes depending on connection.
curl.exe -L https://ollama.com/download/OllamaSetup.exe -o "%USERPROFILE%\Downloads\OllamaSetup.exe"
echo.
if not exist "%USERPROFILE%\Downloads\OllamaSetup.exe" (
    echo ERROR: Download failed. Please check your internet connection and try again.
    pause
    exit /b 1
)
echo Download complete!
echo Launching Installer - CLICK YES on the UAC prompt!
start "" /wait "%USERPROFILE%\Downloads\OllamaSetup.exe"
echo.
echo Done! Now pulling AI models...
echo NOTE: llama3 is about 4GB, mistral is about 4GB. This will take time!
"%LOCALAPPDATA%\Programs\Ollama\ollama.exe" pull llama3
"%LOCALAPPDATA%\Programs\Ollama\ollama.exe" pull mistral
echo.
del "%USERPROFILE%\Downloads\OllamaSetup.exe" >nul 2>&1
echo All Done! The Digital Twin is ready! Run start_openclaw.bat
pause
