package com.socialgrowth.product

import java.io.InputStream

/** Keeps response size limits on Android versions without InputStream.readNBytes. */
internal fun InputStream.readAtMost(limit: Int): ByteArray {
    require(limit >= 0)
    val bytes = ByteArray(limit)
    var size = 0
    while (size < limit) {
        val count = read(bytes, size, limit - size)
        if (count < 0) break
        if (count == 0) {
            val next = read()
            if (next < 0) break
            bytes[size++] = next.toByte()
        } else size += count
    }
    return if (size == limit) bytes else bytes.copyOf(size)
}
