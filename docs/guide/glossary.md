# Glossary

Networking words used in NexMap, in plain English.

### Access point

A box that provides Wi-Fi. It connects wireless devices (phones, laptops) to
the wired network. Often shortened to **AP**.

### Bandwidth

How much data a connection can carry at once, such as 1 Gbps (one gigabit per
second).

### Firewall

A device that decides what traffic may pass between networks, such as between
the internet and your office, to keep unwanted traffic out.

### Gateway

The address devices send traffic to when it's meant for *another* network,
usually the router. Each [subnet](#subnet) needs a gateway inside its own
address range.

### Interface (port)

One physical or virtual connection point on a device, like the numbered
sockets on the front of a switch. A [link](#link) can say which port it uses at
each end.

### IP address

A device's address on the network, such as `192.168.1.20`. Like a street
address, two devices on the same network must never share one. IPv4 addresses
look like `10.0.0.1`; the newer IPv6 ones look like `2001:db8::1`.

### ISP

Internet Service Provider: the company that connects you to the internet.
In a diagram, it's where your network's way out begins.

### Link

A connection between two devices: a cable, fibre or wireless connection. In
NexMap, a line between two devices.

### Modem

The box that connects your home or office to your ISP's line (cable, fibre or
DSL).

### NAS

Network-attached storage: a box full of disks that shares files over the network.

### PDU

Power distribution unit: a power strip built for racks, often with a rating
(how much it can supply) and sometimes monitoring.

### Rack

A standard metal frame or cabinet, 19 inches wide, that holds network and
server equipment stacked on shelves. Its height is measured in [U](#u-rack-unit).

### Redundancy

Having a backup: a second link or device that takes over if the first fails,
so one failure doesn't take the network down.

### Role

What a device is *for* in your design, such as "core switch", "access switch",
"guest Wi-Fi" or "camera". Roles let you write [rules](checking-your-design.md#rules-promises-your-design-keeps)
about groups of devices.

### Router

A device that connects different networks together, and sends traffic
between them, for example between your home network and the internet.

### Single point of failure

One device or link whose failure would cut part of the network off. NexMap
finds these for you in the **Health** tab and with the
[stress-test](checking-your-design.md#stress-test-what-if-something-breaks).

### Subnet

A range of [IP addresses](#ip-address) that belong together, written like
`192.168.1.0/24`. The number after the slash says how big the range is: `/24`
means 256 addresses. Devices in the same subnet can talk directly; to reach
another subnet they go through the [gateway](#gateway).

### Switch

A device with many ports that connects the devices of one network together,
passing traffic only to where it's meant to go.

### Trunk

A link that carries several [VLANs](#vlan) at once, typically between two
switches. The opposite, an **access** link, carries just one VLAN to an
ordinary device.

### U (rack unit)

The standard height of rack equipment: 1U is 1.75 inches (4.45 cm). A 42U
rack holds 42 of them.

### UPS

Uninterruptible power supply: a battery that keeps equipment running through a
power cut, at least long enough to shut down safely.

### VLAN

A virtual LAN: a way to split one physical network into separate ones, such
as keeping guest Wi-Fi apart from office computers, without separate cables.
Each VLAN has a number from 1 to 4094.
