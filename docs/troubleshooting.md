# 手柄连不上时怎么查

stadiacast 的日志在 `runtime\captures\<启动时间>\`，主要有两个文件：

- `dns.jsonl`：DNS 服务记下的每一条查询；
- `server.jsonl`：stadiacast 本身的事件。

网页控制台的"最近事件"里显示的是其中最重要的那部分。

按下面的顺序检查：

1. **`dns.jsonl` 里有没有来自手柄 IP 的查询**
   - **没有**：手柄没有使用电脑做 DNS。
     - 检查路由器：`grep -h stadia /var/etc/dnsmasq.conf.*`；
     - 让手柄关机再唤醒，重新获取 IP；
     - 检查防火墙是否放行了 UDP 53。
   - 路由器配置正确但仍然没有查询，可能和 IPv6 有关，见 `tips.md`。
2. **`server.jsonl` 里有没有 `tcp_accept`**
   - 有 DNS 查询，却没有 `tcp_accept`：TCP 443 被防火墙挡住了，或者被其他程序占用了。
3. **有没有 `tls_alert`**
   - 有：手柄不接受证书。用 stadiacast 自带的证书时不应该出现，检查有没有误加 `--cert` 或 `--self-signed`。
4. **`dtls_connected` 和 `gamepad_created`**
   - `dtls_connected` 没有出现：UDP 40000 起的端口被挡住了。
   - `gamepad_created` 没有出现：虚拟手柄驱动有问题，看 `gamepad_failed` 记录。
5. **灯常亮白色，但出现了 `game_start_failed`**
   - 游戏会话用的端口（UDP 40001 等）被挡住了。这种情况下没有震动。
6. **`helper_exited`**
   - DNS 服务退出了。记录里的 `output` 字段会写明是哪个程序占用了 53 端口。

## 常用命令

```powershell
.\scripts\status.ps1                                            # 每只手柄的状态、电量、玩家编号
Invoke-RestMethod http://127.0.0.1/_status | ConvertTo-Json -Depth 6     # stadiacast 的完整状态
stadiacast-show-input runtime\captures\<启动时间>                # 汇总一次运行里的所有输入
Get-NetFirewallRule -DisplayName 'stadiacast *'                 # 查看防火墙规则
```

stadiacast 自己的文档里也有一张常见事件说明表：https://github.com/jkfran/stadiacast/blob/main/docs/setup.md#reading-the-logs
