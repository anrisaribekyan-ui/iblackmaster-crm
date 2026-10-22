; Установщик помощника станции для Windows (Inno Setup 6).
; Собирается в GitHub Actions: .github/workflows/station-agent.yml
; Ставится без прав администратора в папку пользователя, запускается при входе в Windows.

#define AppName "iBlackMaster Station"
#define AppExe "iBlackMasterStation.exe"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6E3F1C2A-9B7D-4E21-8C55-1A0B7F3D9E42}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=iBlackMaster
DefaultDirName={localappdata}\{#AppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=iBlackMasterStation-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExe}
CloseApplications=no

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Files]
Source: "..\dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\ipatool.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#AppExe}"; Parameters: "run"
Name: "{autoprograms}\{#AppName} — журнал"; Filename: "{userappdata}\{#AppName}\logs"

[Run]
Filename: "{app}\{#AppExe}"; Parameters: "run"; Flags: nowait runhidden; StatusMsg: "Запускаю помощника…"

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im {#AppExe}"; Flags: runhidden; RunOnceId: "StopAgent"

[Code]
var
  CodePage: TInputQueryWizardPage;

function AlreadyConnected(): Boolean;
begin
  Result := FileExists(ExpandConstant('{userappdata}\{#AppName}\config.json'));
end;

procedure InitializeWizard();
var
  Hint: String;
begin
  if AlreadyConnected() then
    Hint := 'Станция уже подключена. Оставьте поле пустым, чтобы сохранить подключение, или вставьте новый код.'
  else
    Hint := 'Откройте CRM → «Приложения» → «Добавить станцию» и скопируйте код подключения.';
  CodePage := CreateInputQueryPage(wpWelcome, 'Подключение к CRM', 'Вставьте код подключения из CRM', Hint);
  CodePage.Add('Код подключения:', False);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  // Обновление: старый помощник держит файл — останавливаем
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/f /im {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Code, Exe: String;
  ResultCode: Integer;
begin
  Result := True;
  if CurPageID <> CodePage.ID then
    Exit;

  Code := Trim(CodePage.Values[0]);
  if Code = '' then
  begin
    if AlreadyConnected() then
      Exit;
    MsgBox('Вставьте код подключения из CRM.', mbError, MB_OK);
    Result := False;
    Exit;
  end;

  // Проверяем код сразу: программа сама сходит в CRM и сохранит подключение
  ExtractTemporaryFile('{#AppExe}');
  Exe := ExpandConstant('{tmp}\{#AppExe}');
  WizardForm.NextButton.Enabled := False;
  try
    if not Exec(Exe, 'connect "' + Code + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      ResultCode := -1;
  finally
    WizardForm.NextButton.Enabled := True;
  end;

  case ResultCode of
    0: Result := True;
    1: begin
         MsgBox('Код не подходит. Скопируйте его из CRM целиком.', mbError, MB_OK);
         Result := False;
       end;
    2: begin
         MsgBox('Не получилось связаться с CRM. Проверьте интернет и что код свежий (не заменён кнопкой «Новый код»).', mbError, MB_OK);
         Result := False;
       end;
  else
    begin
      MsgBox('Не удалось проверить код (ошибка ' + IntToStr(ResultCode) + '). Подробности в журнале помощника.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;
