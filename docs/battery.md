# 电量

## 现象

stadiacast 的 `/_input` 和 `/_status` 里，`battery_percent` 经常是空的。插上充电器的那一刻，它会突然有值。

## 原因

手柄有两处数据带电量：

| 来源 | 什么时候发 | 在 stadiacast 里的位置 |
|---|---|---|
| 电量通知（`ControllerToDisplay` #10） | 电量每变化 1% 发一次。充电或放电时大约每 3 分钟一次，电量不变时不发 | `battery_percent` |
| 连接时的状态应答（`GetControllerStateResponse` 字段 10） | 每次连接时发一次 | `/_status` → `controllers.<编号>.session.display.controller_state.f10` |

stadiacast 只用了第一种，所以有两个时段显示为空：

- 刚连上后的一两分钟（还没有第一次变化）；
- 电量一直不变时，比如充满了。

插拔充电器会让电量马上变动 1%，因此立刻有一次上报。

## 字段 10 就是电量

字段 10 是一个 0 到 1 之间的浮点数。stadiacast 的 schema 把它定义成 `fixed32` 整数，所以显示成一个大整数，比如 `1065353216` 就是 1.0。stadiacast 的文档没有说明这个字段的含义，这是我们根据日志对出来的：

| 连接时字段 10 | 之后第一次电量通知 |
|---|---|
| 0.24 | 25% |
| 0.21 | 22% |
| 0.48 | 47% |
| 0.26 | 27% |
| 1.0（两只手柄都充满了） | 之后没有再上报 |

换算方法（PowerShell）：

```powershell
$raw = (Invoke-RestMethod http://127.0.0.1/_status).controllers.c0.session.display.controller_state.f10
[BitConverter]::ToSingle([BitConverter]::GetBytes([uint32]$raw), 0)   # 例如 0.48
```

## 控制台怎么处理

- 手柄一连上，控制台就读一次 `/_status`，取字段 10 作为当前电量。页面上会注明"连接时读取，之后没有变化"。
- 手柄发来电量通知后，改用通知里的值，并显示"上次变化：X 分钟前"。
- `scripts\status.ps1` 用同样的方法补全，取自连接时的值会标注 `(at connect)`。

控制台只从这两处读取数据，不会给手柄发额外的指令。要让手柄定时上报，只能发固件里没有文档说明的请求，可能让手柄卡死，所以我们没有这样做。

## 还不确定的

同一个应答里的字段 11 取值是 1 或 2，可能表示是否插着充电器。但我们没有记录插拔充电器的时间，没法对照确认。如果你确认了它的含义，欢迎补充。
