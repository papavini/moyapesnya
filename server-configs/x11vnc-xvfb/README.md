# x11vnc-xvfb

VNC сервер, прикреплённый к **Xvfb :99** (на котором работает chromium от `rdp-chromium-xvfb.service`). Позволяет **просматривать и управлять** невидимым chromium с другого компьютера через VNC Viewer — нужно когда надо залогиниться в SUNO / Google, изменить аккаунт, и т.д.

## Установка

```bash
sudo apt install -y x11vnc
sudo cp x11vnc-xvfb.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now x11vnc-xvfb.service

# Открыть порт 5900 в UFW (если включён)
sudo ufw allow from 192.168.0.0/24 to any port 5900
```

## Подключение с Windows

1. Установи [TightVNC Viewer](https://www.tightvnc.com/download.php) (выбери ТОЛЬКО Viewer, не Server)
2. Запусти → Remote Host: `192.168.0.128::5900`
3. Без пароля
4. Увидишь chromium с SUNO, можешь кликать / печатать

## Безопасность

- Без пароля (`-nopw`) — **только для локальной сети**
- UFW разрешает только `192.168.0.0/24`
- Для production/untrusted network:
  - Установить пароль: `x11vnc -storepasswd` → генерит файл, потом заменить в unit'е `-nopw` на `-rfbauth /home/alexander/.vnc/passwd`
  - Или SSH-туннелировать: `ssh -L 5900:localhost:5900 alexander@192.168.0.128` → connect `localhost::5900`

## Проверка

```bash
systemctl is-active x11vnc-xvfb.service
ss -tnlp | grep 5900
```

## Поведение

- После reboot поднимается сам
- После crash Xvfb (chromium упал и systemd его поднимает) x11vnc прицепится к новому Xvfb через `Restart=always` + `After=rdp-chromium-xvfb`
