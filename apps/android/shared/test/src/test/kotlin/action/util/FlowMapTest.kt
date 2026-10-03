package action.util

import app.cash.turbine.test
import androperator.test.ActionTest
import androperator.test.actionTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FlowMapTest : ActionTest {
    @Test fun `basic operations - put, get, remove`() =
        actionTest {
            val map = MutableFlowMap<String, Int>()

            assertNull(map["key"])
            assertEquals(0, map.size)

            map["key"] = 1
            assertEquals(1, map["key"])
            assertEquals(1, map.size)

            val removed = map.remove("key")
            assertEquals(1, removed)
            assertNull(map["key"])
            assertEquals(0, map.size)
        }

    @Test fun `mapFlow emits on modifications`() =
        actionTest {
            val map = MutableFlowMap<String, Int>()

            map.mapFlow.test {
                // Initial state
                assertEquals(emptyMap(), awaitItem())

                // Add first item
                map["one"] = 1
                assertEquals(mapOf("one" to 1), awaitItem())

                // Add second item
                map["two"] = 2
                assertEquals(mapOf("one" to 1, "two" to 2), awaitItem())

                // Remove first item
                map.remove("one")
                assertEquals(mapOf("two" to 2), awaitItem())

                // Cancel to avoid waiting for more items
                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test fun `keysFlow emits on key changes`() =
        actionTest {
            val map = MutableFlowMap<String, Int>()

            map.keysFlow.test {
                // Initial state
                assertEquals(emptySet(), awaitItem())

                // Add first item
                map["one"] = 1
                assertEquals(setOf("one"), awaitItem())

                // Add second item
                map["two"] = 2
                assertEquals(setOf("one", "two"), awaitItem())

                // Update existing key (should not emit)
                map["one"] = 3

                // Remove key
                map.remove("one")
                assertEquals(setOf("two"), awaitItem())

                // Cancel to avoid waiting for more items
                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test fun `valuesFlow emits on value changes`() =
        actionTest {
            val map = MutableFlowMap<String, Int>()

            map.valuesFlow.test {
                // Initial state
                assertEquals(emptyList(), awaitItem())

                // Add first item
                map["one"] = 1
                assertEquals(listOf(1), awaitItem())

                // Add second item
                map["two"] = 2
                assertEquals(listOf(1, 2), awaitItem())

                // Update existing value
                map["one"] = 3
                assertEquals(listOf(3, 2), awaitItem())

                // Cancel to avoid waiting for more items
                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test fun `entriesFlow emits on entry changes`() =
        actionTest {
            val map = MutableFlowMap<String, Int>()

            map.entriesFlow.test {
                // Initial state
                assertEquals(emptySet(), awaitItem().map { TestEntry(it.key, it.value) }.toSet())

                // Add first entry
                map["one"] = 1
                assertEquals(
                    setOf(TestEntry("one", 1)),
                    awaitItem().map { TestEntry(it.key, it.value) }.toSet(),
                )

                // Add second entry
                map["two"] = 2
                assertEquals(
                    setOf(TestEntry("one", 1), TestEntry("two", 2)),
                    awaitItem().map { TestEntry(it.key, it.value) }.toSet(),
                )

                // Update existing entry
                map["one"] = 3
                assertEquals(
                    setOf(TestEntry("one", 3), TestEntry("two", 2)),
                    awaitItem().map { TestEntry(it.key, it.value) }.toSet(),
                )

                // Cancel to avoid waiting for more items
                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test fun `clear operation`() =
        actionTest {
            val map = MutableFlowMap.of("one" to 1, "two" to 2)

            map.mapFlow.test {
                // Initial state
                assertEquals(mapOf("one" to 1, "two" to 2), awaitItem())

                // Clear the map
                map.clear()
                assertEquals(emptyMap(), awaitItem())
                assertTrue(map.isEmpty())

                // Cancel to avoid waiting for more items
                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test fun `companion object factory methods`() =
        actionTest {
            val emptyMap = MutableFlowMap.create<String, Int>()
            assertTrue(emptyMap.isEmpty())

            val populatedMap = MutableFlowMap.of("one" to 1, "two" to 2)
            assertEquals(2, populatedMap.size)
            assertEquals(1, populatedMap["one"])
            assertEquals(2, populatedMap["two"])
        }

    @Test fun `containsKey and containsValue`() =
        actionTest {
            val map = MutableFlowMap.of("one" to 1, "two" to 2)

            assertTrue(map.containsKey("one"))
            assertFalse(map.containsKey("three"))

            assertTrue(map.containsValue(1))
            assertFalse(map.containsValue(3))
        }

    @Test fun `putIfDifferent adds value only if key is new`() =
        actionTest {
            val map = MutableFlowMap<String, Int>()

            // Attempt to put a new key-value pair
            val previousValue1 = map.putIfDifferent("one", 1)
            assertNull(previousValue1) // Should return null as the key was new
            assertEquals(1, map["one"]) // Verify the value is added

            // Attempt to put the same key with a different value
            val previousValue2 = map.putIfDifferent("one", 2)
            assertEquals(1, previousValue2) // Should return the previous value
            assertEquals(1, map["one"]) // Verify the value remains unchanged

            // Attempt to put a new key-value pair
            val previousValue3 = map.putIfDifferent("two", 2)
            assertNull(previousValue3) // Should return null as the key was new
            assertEquals(2, map["two"]) // Verify the new value is added
        }

    @Test fun `vararg constructor creates map with initial entries`() =
        actionTest {
            val map = MutableFlowMap<String, Int>("one" to 1, "two" to 2, "three" to 3)

            assertEquals(3, map.size)
            assertEquals(1, map["one"])
            assertEquals(2, map["two"])
            assertEquals(3, map["three"])

            map.mapFlow.test {
                // Initial state should contain all entries
                assertEquals(
                    mapOf("one" to 1, "two" to 2, "three" to 3),
                    awaitItem(),
                )

                // Verify keys flow
                map.keysFlow.test {
                    assertEquals(setOf("one", "two", "three"), awaitItem())
                    cancelAndIgnoreRemainingEvents()
                }

                // Verify values flow
                map.valuesFlow.test {
                    assertEquals(listOf(1, 2, 3), awaitItem())
                    cancelAndIgnoreRemainingEvents()
                }

                cancelAndIgnoreRemainingEvents()
            }
        }

    private data class TestEntry<K, V>(
        override val key: K,
        override val value: V,
    ) : Map.Entry<K, V>
}
