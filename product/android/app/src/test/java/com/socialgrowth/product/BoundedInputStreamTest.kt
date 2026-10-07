package com.socialgrowth.product

import java.io.ByteArrayInputStream
import java.io.InputStream
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class BoundedInputStreamTest {
    @Test fun stopsAtLimitWithoutConsumingTheRemainder() {
        val stream = ByteArrayInputStream(byteArrayOf(1, 2, 3, 4))
        assertContentEquals(byteArrayOf(1, 2, 3), stream.readAtMost(3))
        assertEquals(4, stream.read())
    }

    @Test fun acceptsShortAndEmptyResponses() {
        assertContentEquals(byteArrayOf(1), ByteArrayInputStream(byteArrayOf(1)).readAtMost(8))
        assertContentEquals(byteArrayOf(), ByteArrayInputStream(byteArrayOf()).readAtMost(8))
        val stream = ByteArrayInputStream(byteArrayOf(1))
        assertContentEquals(byteArrayOf(), stream.readAtMost(0))
        assertEquals(1, stream.read())
        assertFailsWith<IllegalArgumentException> { stream.readAtMost(-1) }
    }

    @Test fun handlesPartialReadsAndZeroProgress() {
        val source = ByteArrayInputStream(byteArrayOf(1, 2, 3))
        val stream = object : InputStream() {
            private var first = true
            override fun read() = source.read()
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                if (first) { first = false; return 0 }
                return source.read(bytes, offset, minOf(length, 1))
            }
        }
        assertContentEquals(byteArrayOf(1, 2, 3), stream.readAtMost(8))
    }
}
