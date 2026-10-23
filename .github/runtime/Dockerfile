FROM ubuntu:24.04@sha256:a2d43bffc46670d7108bb3c0468c67c5557c4c92e83e1e34cbff1322ad1b94dc

LABEL org.opencontainers.image.source="https://github.com/thisnameissoclever/terrilives"

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC \
    PATH=/opt/rust/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    CARGO_HOME=/tmp/terrilives-cargo CARGO_BUILD_JOBS=2

COPY inputs.lock.json inventory.py Dockerfile .dockerignore /opt/terrilives-mutation-runtime/recipe/

# Bootstrap HTTPS trust from the same pinned certificate package before installing.
ADD --checksum=sha256:6bac2a01979e210d9eac1d4d56747ec709ea60654744d66705dc3c36e7629e50 https://snapshot.ubuntu.com/ubuntu/20261001T000000Z/pool/main/c/ca-certificates/ca-certificates_20260601~24.04.1_all.deb /tmp/ca-certificates.deb

# Only image production installs packages. Consumers use the resulting digest.
RUN dpkg-deb --extract /tmp/ca-certificates.deb /tmp/ca-bootstrap \
    && cat /tmp/ca-bootstrap/usr/share/ca-certificates/mozilla/*.crt > /tmp/ca-bootstrap.pem \
    && rm -f /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources \
    && printf '%s\n' \
       'deb [check-valid-until=no] https://snapshot.ubuntu.com/ubuntu/20261001T000000Z noble main' \
       'deb [check-valid-until=no] https://snapshot.ubuntu.com/ubuntu/20261001T000000Z noble-updates main' \
       'deb [check-valid-until=no] https://snapshot.ubuntu.com/ubuntu/20261001T000000Z noble-security main' \
       > /etc/apt/sources.list \
    && apt-get -o Acquire::https::CaInfo=/tmp/ca-bootstrap.pem update \
    && packages='build-essential=12.10ubuntu1 python3=3.12.3-0ubuntu2.1 \
       git=1:2.43.0-1ubuntu7.3 binutils=2.42-4ubuntu2.10 \
       ca-certificates=20260601~24.04.1 curl=8.5.0-2ubuntu10.15 \
       xz-utils=5.6.1+really5.4.5-1ubuntu0.3 \
       pkg-config=1.8.1-2build1 libssl-dev=3.0.13-0ubuntu3.16' \
    && for specification in $packages; do \
         candidate="$(apt-cache policy "${specification%%=*}" | sed -n 's/^  Candidate: //p')"; \
         [ "$candidate" = "${specification#*=}" ] || { printf '%s\n' "locked $specification differs from APT candidate $candidate" >&2; exit 1; }; \
       done \
    && apt-get -o Acquire::https::CaInfo=/tmp/ca-bootstrap.pem install -y --no-install-recommends $packages \
    && rm -rf /var/lib/apt/lists/* /tmp/ca-bootstrap /tmp/ca-bootstrap.pem /tmp/ca-certificates.deb

RUN python3 /opt/terrilives-mutation-runtime/recipe/inventory.py install \
    && python3 /opt/terrilives-mutation-runtime/recipe/inventory.py record \
    && python3 /opt/terrilives-mutation-runtime/recipe/inventory.py verify

WORKDIR /workspace
CMD ["bash"]
