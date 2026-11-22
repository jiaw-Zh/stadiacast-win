# 完整步骤

示例里用到的地址如下，换成你自己的即可：

| 角色 | 示例地址 |
|---|---|
| 路由器 | 192.168.1.1 |
| 运行 stadiacast 的电脑 | 192.168.1.100 |
| 手柄 A | 192.168.1.201 |
| 手柄 B | 192.168.1.202 |

下文中的 PowerShell 命令，除非特别注明，都在这个文件夹里运行。

## 1. 安装 stadiacast

```powershell
$env:VGAMEPAD_SKIP_VIGEMBUS_INSTALL = 'true'   # 不让 vgamepad 在安装时弹出旧版驱动的安装程序
uv tool install "stadiacast[ble,gamepad]==1.3.0"
```

- `ble` 用于通过蓝牙配网，`gamepad` 用于创建虚拟 Xbox 手柄。
- 命令装在 `%USERPROFILE%\.local\bin` 下，共三个：`stadiacast`、`stadiacast-provision`、`stadiacast-show-input`。
- 如果提示命令找不到，运行一次 `uv tool update-shell`，然后重开终端。
- 卸载用 `uv tool uninstall stadiacast`。

## 2. 安装 ViGEmBus 驱动

从 https://github.com/nefarius/ViGEmBus/releases 下载 1.22.0（这是最终版本），安装时需要管理员权限。

**检查是否装好**：打开设备管理器，"系统设备"下应该有 **Nefarius Virtual Gamepad Emulation Bus**。

如果只有驱动服务、没有这个设备，stadiacast 启动时会报 `VIGEM_ERROR_BUS_NOT_FOUND`。这种情况重新安装 1.22.0 就能解决。

## 3. 判断固件，必要时刷回 Wi-Fi 固件

### 判断

只看灯分不出来是哪种固件：两种固件进入配对或配网模式时，都是橙灯闪烁。下面两种方法任选一种。

**方法一：用刷机网页检查（最简单，只需一根数据线）**

1. 用 USB **数据线**把手柄连到电脑。手柄正常开机即可，不用进任何特殊模式。
2. 用 Chrome 或 Edge 打开 https://luigimannoni.github.io/stadia-controller-flasher/ ，找到 **Check mode and updates**，点 **Check**。
3. 点 **Allow Chrome to verify**，在弹出的设备列表里选手柄（一般显示为 Stadia Controller）。
4. 网页会读取手柄当前的固件版本，并给出结果：
   - 显示 **Your controller is in Stadia Wi-Fi mode**：是 Wi-Fi 固件，可以跳过下面的刷机，直接看第 4 步。
   - 显示蓝牙模式：需要刷回 Wi-Fi 固件。
   
   按网页代码里的规则，版本号不超过 320480 的是 Wi-Fi 固件，更高的是蓝牙固件。

检查只是读取信息。如果网页提示有蓝牙模式的更新，**不要点更新**。

**方法二：不接线，用蓝牙检测**

适合手边没有数据线，或者想一次检测好几只手柄的情况。先让手柄进入配网模式（方法见第 4 步），然后用 stadiacast 的 Python 运行检测脚本：

```powershell
& (Join-Path (uv tool dir) 'stadiacast\Scripts\python.exe') scripts\find-controllers.py
```

- **Wi-Fi 固件**：会显示 `Wi-Fi firmware, in setup mode`，以及固件版本，比如 `316382`。
- **蓝牙固件**：能扫到 `StadiaXXXX-xxxx` 这样的名字，但没有配网服务。名字里的 XXXX 是序列号的后 4 位，手柄有好几只时可以用它区分。

### 刷回 Wi-Fi 固件（仅蓝牙固件需要）

使用社区工具：https://luigimannoni.github.io/stadia-controller-flasher/ ，用 Chrome 或 Edge 打开，**网址后面不要加参数**。这个工具保存了 Google 原版的刷机网页，恢复 Wi-Fi 时写入的是 Google 签名的 `ota.316382 gotham-pvt-b`。stadiacast 只在 282115 上测过，但据 [issue #17](https://github.com/jkfran/stadiacast/issues/17) 的分析，这两个版本基本是同一份代码，实际也能正常使用。

> 工具作者声明它可能让手柄变砖，风险自负。

1. **先充电至少 30 分钟**，电量低于 10% 时网页不让继续。用 USB **数据线**直接连电脑，不要经过 USB 集线器。
2. **检查序列号。** 用方法一检查时，网页会读取序列号，按工具代码里的规则：
   - 91–94 开头：直接报错，拒绝刷机；
   - 95–97 开头，或者 9809 以下的 98 开头：属于工程样机，没有对应的 Wi-Fi 固件。
   
   想自己看序列号，可以在设备管理器里找到 `USB Composite Device`（VID 18D1、PID 9400），它的设备实例路径最后一段就是。我们的两只分别是 99 和 9A 开头。
3. 网页识别出手柄是蓝牙模式后，点 **Revert to Wi-Fi mode (Dogfood only)**。
4. **解锁**：先拔掉 USB 线（如果手柄又亮了，长按 Stadia 键 4 秒关机）。然后按住左上角的三点键，同时插上线。最后同时按下三点键、Google Assistant 键、A 和 Y。这时手柄不会有任何反应，是正常的。
5. 浏览器弹出设备列表时，选 **SP Blank RT Family**，点 Download Wi-Fi mode。下一次弹出时选 **USB COMPOSITE DEVICE**，点 Install & enable Wi-Fi mode。**写入过程中不要拔线。**
6. 卡住时：拔掉线，长按 Stadia 键 10 秒，然后从第 4 步重来。

## 4. 写入 Wi-Fi

### 进入配网模式

1. **拔掉 USB 线。**
2. 长按 Stadia 键约 4 秒关机。
3. 按住 Y 不放，再按住 Stadia 键约 1 秒，直到手柄震动。继续按住 Y，直到灯开始**橙色闪烁**。
4. 如果还是不行：在关机状态下，同时按住 Assistant 键和 Capture 键 6 秒，恢复出厂设置。

### 写入

官方 Stadia app 已经停止服务，改用 stadiacast 自带的工具：

```powershell
stadiacast-provision scan                                   # 记下地址：每次进入配网模式，地址都会变
stadiacast-provision provision --address <地址> --ssid <你的 SSID>   # 按提示输入密码
```

- 看到 `Done` 就是写入成功。之后手柄会退出配网模式，开始连接 Wi-Fi。
- 出现 `STATE -> 0x4f`：一般是密码错了，或者网络不是 WPA2-Personal。
- **同一时间只让一只手柄处于配网模式。** 配网模式下的广播里没有名字，两只同时开着就分不清是哪只。
- **配网后的第一次开机一直闪白灯、连不上，这是正常的。** 正好趁这次开机，去路由器上找到手柄的 MAC 地址。

## 5. 路由器：只让手柄使用电脑做 DNS

1. 在 LuCI 的 **网络 → DHCP/DNS → 静态地址分配** 里，给电脑和每只手柄都固定一个 IP。手柄在 DHCP 列表里显示为 `Stadia-xxxx`，MAC 地址以 `F0:EF:86` 开头。
2. 编辑 `scripts\router-dhcp-tag.sh` 开头的电脑 IP 和手柄 MAC，然后在路由器的 SSH 里逐行执行。
3. 检查是否生效：

   ```sh
   grep -h stadia /var/etc/dnsmasq.conf.*
   ```

   应该能看到 1 行 `dhcp-option=tag:stadia,6,<电脑 IP>`，以及每只手柄各一行 `dhcp-host=…,set:stadia,…`。

手柄要重新获取 IP 才会用上新的 DNS，所以设置完后要关机再唤醒一次。

## 6. 控制台设置和防火墙

1. 双击 `stadia-console.cmd`。第一次运行会根据 `webui\config.example.json` 生成 `webui\config.json`。
2. 在网页的"设置"里填好上游 DNS（一般就是路由器的 IP）和每只手柄的 IP，然后保存。
3. 用**管理员** PowerShell 运行：

   ```powershell
   .\scripts\firewall.ps1 -RemoveAutoRules
   ```

   它会读取 `config.json` 里的手柄 IP，只对这些 IP 放行以下端口：

   | 协议 | 端口 |
   |---|---|
   | UDP | 53，40000–40007 |
   | TCP | 53，443 |

   `-RemoveAutoRules` 会删掉 Windows 自动替 Python 建的规则（原因见 `tips.md`）。如果第一次启动 stadiacast 后又弹出防火墙提示，就再运行一次这个命令。

## 7. 启动和连接

1. 在控制台里点"启动 stadiacast"。
2. 按 Stadia 键约 1 秒唤醒手柄。**先唤醒 A，等它的灯常亮后再唤醒 B。**
3. 手柄**震两下、灯常亮白色**，就是连上了。控制台里对应的卡片会显示"已连接"和玩家编号。从唤醒到虚拟手柄创建好，大约需要 8 秒。
4. 验证按键：按 Win+R，运行 `joy.cpl`，或者直接看网页卡片。
5. 验证震动：点卡片上的"震动"按钮。

## 启动参数说明

控制台和 `scripts\start-stadiacast.ps1` 用的是同一组参数：

```
stadiacast --preset live --no-sntp --dns-upstream <上游 DNS> --controller-ip <第一只手柄 IP> `
  --dns-redirect time.google.com,clients3.google.com --stadiaconfig 'json:{}' --gamepad vigem
```

| 参数 | 作用 |
|---|---|
| `--preset live` | stadiacast 作者在真机上验证过的一组参数 |
| `--no-sntp` | 不启动时间服务器。Windows 的时间服务（w32time）占着 UDP 123，手柄也能从 HTTP 响应里拿到时间 |
| `--dns-upstream` | 手柄查询的其他域名转发到这里 |
| `--controller-ip` | 用来选出朝向手柄的那块网卡 |
| `--dns-redirect ... clients3.google.com` 加 `--stadiaconfig 'json:{}'` | 手柄开机时要取一次配置。默认会转发到 Google，这里改为本机直接回复，在访问不了 Google 的网络里也不会卡住 |
| `--gamepad vigem` | 每只手柄创建一个 Xbox 360 虚拟手柄，同时开启游戏会话，游戏的震动才能传回手柄 |

要改参数，`webui\server.py` 的 `receiver_args()` 和 `scripts\start-stadiacast.ps1` 两处要一起改。
