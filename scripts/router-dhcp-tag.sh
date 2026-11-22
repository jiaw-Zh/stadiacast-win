# Run on an OpenWrt / ImmortalWrt router over SSH (ssh root@<router>).
# Gives the controllers, and only them, the PC that runs stadiacast as their DNS server.
#
# Before: give the PC and each controller a static lease (LuCI: Network -> DHCP and DNS ->
# Static Leases). The controllers show up in the DHCP list as Stadia-xxxx, MAC prefix F0:EF:86.
# Replace the three values below with yours.

PC_IP=192.168.1.100                                  # the PC that runs stadiacast
CONTROLLER_MACS="F0:EF:86:00:00:01 F0:EF:86:00:00:02" # your controllers' Wi-Fi MACs

# 1. The tag: DHCP option 6 (DNS server) = the PC, and nothing else. No second, public DNS:
#    a controller that asks it gets Google's real address and never reaches the PC.
uci -q delete dhcp.stadia
uci set dhcp.stadia=tag
uci add_list dhcp.stadia.dhcp_option="6,$PC_IP"

# 2. Put the controllers' static leases under the tag, found by MAC.
#    Older LuCI has no field for this on the lease's page, hence the command line.
for mac in $CONTROLLER_MACS; do
  s=$(uci show dhcp | grep -i "\.mac='$mac'" | cut -d. -f2)
  echo "$mac -> ${s:-no static lease with this MAC}"
  [ -n "$s" ] && uci set dhcp.$s.tag='stadia'
done

# 3. Apply. Nothing changes until dnsmasq restarts.
uci commit dhcp
/etc/init.d/dnsmasq restart

# 4. Check: one dhcp-option line for the tag, one dhcp-host line per controller.
grep -h stadia /var/etc/dnsmasq.conf.*
# dhcp-host=F0:EF:86:00:00:01,set:stadia,192.168.1.201,Stadia-xxxx
# dhcp-host=F0:EF:86:00:00:02,set:stadia,192.168.1.202,Stadia-yyyy
# dhcp-option=tag:stadia,6,192.168.1.100
#
# The controllers take the new DNS at their next DHCP lease: turn them off and wake them again.
