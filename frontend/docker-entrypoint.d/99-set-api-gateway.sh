#!/bin/sh
set -e
# Compose bridge networks use a gateway like 172.18.0.1; host.docker.internal often points at 172.17.0.1
# (docker0). Proxying to the wrong one causes upstream timeouts. Use this container's default gateway.
GW=$(ip route show default 2>/dev/null | awk '{print $3; exit}')
if [ -z "$GW" ]; then
  echo "flss: could not detect default gateway for nginx API upstream" >&2
  exit 1
fi
sed -i "s/__DOCKER_HOST_GATEWAY__/${GW}/g" /etc/nginx/conf.d/default.conf
