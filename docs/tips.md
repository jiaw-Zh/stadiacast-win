# 踩过的坑

按出现的顺序排列。每条都写了现象、原因和解决办法。

## 固件和刷机

- **分不清是哪种固件。** 两种固件闪橙灯时都表示在等待配对，只看灯看不出来。最简单的办法是用数据线连上电脑，在刷机网页上点 **Check mode and updates** → **Check**，网页会直接告诉你是哪种模式（见 `guide.md` 第 3 步）。不接线的话，可以让手柄进入配网模式，再运行 `scripts\find-controllers.py`：Wi-Fi 固件有配网服务（`0xFEA0`），蓝牙固件没有，而且会显示 `StadiaXXXX-xxxx` 这样的名字。
- **刷机前先检查序列号和电量。** 社区刷机工具会拒绝序列号开头为 91–94 的手柄；95–97 开头是工程样机，没有对应的 Wi-Fi 固件。电量低于 10% 时网页不让继续。
- **刷完后固件显示 316382，不是 stadiacast 文档写的 282115。** 这是正常的，社区工具写入的就是 316382。

## 配网

- **按住 Y 再按 Stadia 键，灯不闪橙。** 原因是 USB 线还插着：手柄由电脑供电，关机后会自己重新开机。拔掉线再试。
- **官方 Stadia app 不能用了**，用 `stadiacast-provision` 代替。
- **扫描得到的蓝牙地址，下次可能连不上。** 手柄每次进入配网模式都会换一个地址，所以每次配网前都要重新 `scan`。
- **有好几只手柄时，配网前不知道是哪只。** 配网模式下的广播里没有名字。解决办法是同一时间只让一只进入配网模式。连上 Wi-Fi 后，可以用 DHCP 主机名 `Stadia-xxxx` 区分。
- **写入 Wi-Fi 后一直闪白灯。** 配网后的第一次开机本来就连不上。等一分钟，关机后再唤醒。
- **配网成功了，过一会儿手柄又自己回到配网模式（橙灯）。** 在 DNS 改好之前，手柄会去连 Google 的真实服务器，连接失败后就会回到配网模式。我们遇到过一次，推测原因如上，但没有完全确认。建议先把路由器和电脑都准备好，最后再写入 Wi-Fi。

## 路由器和 DNS

- **手柄必须使用电脑做 DNS。** stadiacast 就是通过 DNS，把手柄要连的 Google 域名解析到电脑上。
- **不要给全网下发电脑作为 DNS。** 否则其他设备的 `*.googleapis.com` 等域名也会被解析到电脑，它们的 Google 服务都会失效。
- **给手柄下发的 DNS 里只写电脑一个地址。** 如果加了一个备用的公共 DNS，手柄可能去问它，拿到真实地址。另外，被重定向的域名查询如果失败，固件会改用 8.8.8.8。
- **LuCI 的静态地址编辑页面上没有"标签"一栏**（至少 ImmortalWrt 的这一版是这样），新建标签和打标签都要在 SSH 里完成。改完必须执行 `/etc/init.d/dnsmasq restart`，否则不会生效。
- **IPv6**：路由器还会通过 IPv6 下发 DNS。按设备设置 DNS 的那条配置管不到这部分。我们这里没有出问题，如果你的手柄一直不来查询电脑的 DNS，可以从这里查起。
- **没有 OpenWrt 怎么办？** stadiacast 文档推荐让电脑开热点，手柄直接连电脑。但 Windows 移动热点自带的连接共享（ICS）会运行自己的 DNS 代理，手柄的查询到不了 stadiacast。stadiacast 的 [issue #18](https://github.com/jkfran/stadiacast/issues/18) 给出了一个可用的做法：stadiacast 运行期间，把电脑自己网卡的 DNS 设为 127.0.0.1，再加上 `--advertise-ip 192.168.137.1`。这个方案我们没有实测。
- **Wi-Fi 要求**：手柄只支持 WPA2-Personal（AES）。WPA3、WPA2/WPA3 混合模式、开启 PMF、AP 隔离、访客网络都可能导致连不上。

## Windows

- **防火墙。** WLAN 经常被识别为"公用网络"。stadiacast 第一次监听端口时，Windows 会替它用的 Python 自动建规则：
  - 如果你在弹窗里点了取消，或者没有理会，生成的是**阻止**规则，它会盖过任何允许规则；
  - 如果点了允许，生成的是对**所有来源**开放的允许规则，范围太大。
  
  `scripts\firewall.ps1 -RemoveAutoRules` 会只对手柄 IP 放行，并删掉这些自动规则。
- **UDP 123 被占用。** Windows Time 服务（w32time）占着这个端口。不需要停掉它，启动 stadiacast 时加 `--no-sntp` 就行。
- **报 `VIGEM_ERROR_BUS_NOT_FOUND`，但 ViGEmBus 服务在运行。** 这是残留的坏安装：有驱动服务，却没有虚拟总线设备。重新安装 ViGEmBus 1.22.0 即可，装好后设备管理器里会出现 `Nefarius Virtual Gamepad Emulation Bus`。
- **PowerShell 里用 `curl.exe -d '{"left":40000}'` 报 `Expecting property name enclosed in double quotes`。** PowerShell 调用外部程序时会去掉参数里的双引号。改用：

  ```powershell
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1/_rumble?controller=<手柄IP>" -ContentType 'application/json' -Body '{"left":40000,"right":40000,"ms":1000}'
  ```

- **stadiacast 的控制接口拒绝网页发来的请求。** 浏览器发出的非 GET 请求都带 `Origin` 头，stadiacast 一律拒绝。所以网页控制台需要在中间加一个本机后台服务（`webui\server.py`）。

## 使用

- **玩家编号**：按唤醒的先后顺序分配，c0、c1 这些编号也是。每次都先唤醒同一只手柄，它就固定是玩家 1。
- **要指定某只手柄，用 IP。** stadiacast 的接口支持 `?controller=<IP>`。c0、c1 这些编号会随唤醒顺序变化，IP 不会。
- **电量经常显示为空。** 手柄只在电量变化 1% 时才上报一次：刚连上的头几分钟不报，充满或电量不变时也不报，插拔充电器时会马上报一次。控制台会补上连接那一刻的电量，见 `battery.md`。
- **电脑的 IP 必须固定。** 手柄的 DNS 指向的就是它。
- **电脑重启后**，控制台和 stadiacast 都要重新启动。
- **stadiacast 的日志会一直增长**。手柄一直连着时大约每秒 0.4 KB，在 `runtime\captures\<时间>\` 下，不需要时可以删掉旧的。

## 给想改 stadiacast 代码的人

- 在中文 Windows 上运行 stadiacast 1.3.0 的测试，会有几个失败，但都不是产品本身的 bug：
  - 有的测试用 `read_text()` 读取日志时没有指定编码，在中文系统上默认按 GBK 解码，于是报错；
  - Python 3.13 以前，Windows 上 `time.monotonic` 的精度只有 15.6 ms，会让几个依赖计时的测试失败。用 Python 3.14 时只剩前一类。
- mypy 在 Windows 上会对 `micdevice.py` 里只在 Linux 上运行的 `fcntl` 调用报错，CI 只在 Linux 上跑 mypy，所以没被发现。
