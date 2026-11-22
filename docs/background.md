# 背景：为什么选 stadiacast

## Stadia 手柄的两种固件

- **Wi-Fi 固件**（代号 gotham）：出厂时的固件。手柄自己连 Wi-Fi，直接和 Google 的云端通信。Stadia 在 2023-01-18 停服后，它就失去了连接对象。
- **蓝牙固件**（代号 bruce）：Google 停服后提供的转换工具会刷入这个固件，此后手柄就是一个普通的蓝牙手柄。官方转换工具已经下线，但社区保存了它的备份，并且可以刷回 Wi-Fi 固件。

## 两个开源项目

| | [StadiaWireless](https://github.com/helloparthshah/StadiaWireless) | [stadiacast](https://github.com/jkfran/stadiacast) |
|---|---|---|
| 原理 | 手柄用 USB 线插在 Android 手机上；手机浏览器读取手柄状态，通过局域网发给电脑 | 在局域网里扮演 Google 的服务器，手柄用自己的 Wi-Fi 直接连电脑 |
| 手柄要求 | 什么固件都行，USB 线一直插着 | 必须是 Wi-Fi 固件 |
| 额外设备 | 一部 Android 手机，网页必须一直亮着、在前台 | 不需要；但路由器要能把手柄的 DNS 指向电脑 |
| 系统 | 仅 Windows | Windows、macOS、Linux |
| 震动、耳机、麦克风 | 震动有缺陷；没有耳机和麦克风 | 都有 |
| 维护 | 最后一次更新在 2023 年 | 2026 年仍在活跃开发 |

StadiaWireless 写于 Google 推出蓝牙固件之前，当时是让 Wi-Fi 手柄在电脑上"无线"使用的权宜之计。现在有了蓝牙固件，它就没有太多用处了。

## stadiacast 是怎么工作的

1. **DNS**：手柄使用电脑做 DNS。stadiacast 的 DNS 服务把 `*.googleapis.com` 等域名解析到电脑，其余域名转发给上游 DNS。
2. **HTTPS**：固件只检查证书链是否通到 Google Trust Services 的根证书，不检查域名、有效期，也不查吊销。stadiacast 自带一条这样的证书链：它是作者为一个专用域名申请的，公开之前已经主动吊销，对普通 TLS 客户端毫无用处，但手柄会接受。
3. **WebRTC**：手柄在注册请求里带上 WebRTC 邀请，stadiacast 完成 STUN、DTLS 和 SRTP 握手，再完成一系列 RPC 应答，之后手柄开始发送输入。
4. **游戏会话**：手柄会再建立第二条连接，这是控制震动马达的唯一途径。

协议细节见 stadiacast 的 `docs/protocol.md`。它的 §12 区分了哪些已经确认、哪些还只是推测。

## stadiacast 的风险

- 项目很新（2026 年 10 月底首次发布），绝大多数代码出自同一位作者。
- ViGEmBus 驱动在 2023 年已停止维护，1.22.0 是最终版本，但目前在 Windows 10/11 上仍然可用。
- 控制接口没有认证，只适合在可信的局域网里使用，所以防火墙规则要只对手柄的 IP 放行。
