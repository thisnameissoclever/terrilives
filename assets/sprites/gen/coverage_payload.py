"""Move coverage bytes out of the generated TypeScript into one binary file.

Every coverage record the generator builds carries its pixels as a base64
`values` string. Written into atlas.ts, those strings made the game's script
bundle about a hundred megabytes, which a phone has to download and compile
before the loading screen can change.

`CoveragePayload.place` swaps a record's `values` for an `offset` into one
shared byte payload. Identical byte runs share one offset, so equal offsets
mean equal bytes. Each run starts on a four-byte boundary, so the browser can
read 16-bit records through a typed-array view without copying them.

The payload is published gzip-compressed, because GitHub Pages does not
compress binary files and the raw bytes are mostly zeros. The file name holds
the SHA-256 of the compressed bytes, as the atlas pages do. Different zlib
builds can compress the same payload to different bytes, so the generator
compares decompressed payloads, never compressed bytes, and keeps an existing
file whose payload is unchanged.
"""
import base64
import gzip
import hashlib
import os
import re
import struct
import zlib

ALIGNMENT = 4
FILE_PATTERN = re.compile(r"^coverage-[0-9a-f]{64}\.bin$")


def coverage_file_name(file_sha256):
    """The immutable public pathname paired with one exact compressed file."""
    return f"coverage-{file_sha256}.bin"


class CoveragePayload:
    """Collects coverage bytes and hands back records that point into them."""

    def __init__(self):
        self._chunks = []
        self._length = 0
        self._offsets = {}

    def place(self, record):
        """The same record with `values` replaced by the offset of its bytes."""
        raw = base64.b64decode(record["values"], validate=True)
        offset = self._offsets.get(raw)
        if offset is None:
            padding = -self._length % ALIGNMENT
            if padding:
                self._chunks.append(bytes(padding))
                self._length += padding
            offset = self._length
            self._offsets[raw] = offset
            self._chunks.append(raw)
            self._length += len(raw)
        return {("offset" if key == "values" else key): (offset if key == "values" else value)
                for key, value in record.items()}

    def place_all(self, records):
        return [self.place(record) for record in records]

    def place_values(self, records):
        """Place a dict of records, keeping its keys and their order."""
        return {key: self.place(record) for key, record in records.items()}

    def payload(self):
        return b"".join(self._chunks)


def compress(payload):
    """Gzip with a fixed header, so the bytes depend only on zlib's deflate.

    `gzip.compress` writes the operating system into the header on some
    Python versions, which would give a Windows checkout a different file.
    """
    deflate = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    body = deflate.compress(payload) + deflate.flush()
    header = b"\x1f\x8b\x08\x00" + bytes(4) + b"\x02\xff"
    trailer = struct.pack("<II", zlib.crc32(payload), len(payload) & 0xFFFFFFFF)
    return header + body + trailer


def decompress(data):
    return gzip.decompress(data)


def file_paths(public):
    """Only generator-owned coverage files, never arbitrary binaries."""
    try:
        names = os.listdir(public)
    except FileNotFoundError:
        return []
    return sorted(os.path.join(public, name) for name in names if FILE_PATTERN.fullmatch(name))


def existing_file(public, payload):
    """The committed bytes of a correctly named file holding `payload`, if any."""
    for path in file_paths(public):
        with open(path, "rb") as fh:
            data = fh.read()
        if coverage_file_name(hashlib.sha256(data).hexdigest()) != os.path.basename(path):
            continue
        try:
            if decompress(data) == payload:
                return data
        except (OSError, EOFError, zlib.error):
            continue
    return None


def restore(record, payload):
    """The record as the generator built it, with base64 `values` again."""
    if "offset" not in record:
        return record
    left, top, right, bottom = record["box"]
    stride = 2 if record.get("bitDepth") == 16 or record.get("encoding") == "float16" else 1
    start = record["offset"]
    end = start + (right - left) * (bottom - top) * stride
    if end > len(payload):
        raise ValueError("coverage record reaches past the end of its payload")
    values = base64.b64encode(payload[start:end]).decode("ascii")
    return {("values" if key == "offset" else key): (values if key == "offset" else value)
            for key, value in record.items()}
