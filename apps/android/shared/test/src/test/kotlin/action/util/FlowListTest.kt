package action.util

import app.cash.turbine.test
import androperator.test.ActionTest
import androperator.test.actionTest
import kotlinx.coroutines.flow.first
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FlowListTest : ActionTest {
    @Test fun `basic operations - add, get, remove`() =
        actionTest {
            val list = MutableFlowList<String>()

            assertTrue(list.add("first"))
            assertEquals("first", list[0])
            assertEquals(1, list.size)

            list.add(0, "zero")
            assertEquals("zero", list[0])
            assertEquals("first", list[1])

            assertTrue(list.remove("first"))
            assertEquals(1, list.size)
            assertEquals("zero", list[0])
        }

    @Test fun `collection operations - addAll, removeAll`() =
        actionTest {
            val list = MutableFlowList<String>()
            val items = listOf("one", "two", "three")

            assertTrue(list.addAll(items))
            assertEquals(3, list.size)
            assertEquals("one", list[0])

            list.addAll(0, listOf("zero"))
            assertEquals("zero", list[0])
            assertEquals("one", list[1])

            assertTrue(list.removeAll(listOf("one", "three")))
            assertEquals(2, list.size)
            assertEquals("zero", list[0])
            assertEquals("two", list[1])
        }

    @Test fun `listFlow emits on modifications`() =
        actionTest {
            val list = MutableFlowList<String>()

            list.listFlow.test {
                // Initial state
                assertEquals(emptyList(), awaitItem())

                // Add first item
                list.add("first")
                assertEquals(listOf("first"), awaitItem())

                // Add second item
                list.add("second")
                assertEquals(listOf("first", "second"), awaitItem())

                // Remove first item
                list.remove("first")
                assertEquals(listOf("second"), awaitItem())

                // Cancel to avoid waiting for more items
                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test fun `sizeFlow emits on size changes`() =
        actionTest {
            val list = MutableFlowList<String>()

            list.sizeFlow.test {
                // Initial state
                assertEquals(0, awaitItem())

                // Add first item
                list.add("one")
                assertEquals(1, awaitItem())

                // Add second item
                list.add("two")
                assertEquals(2, awaitItem())

                // Clear the list
                list.clear()
                assertEquals(0, awaitItem())

                // Cancel to avoid waiting for more items
                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test fun `companion object factory methods`() =
        actionTest {
            val emptyList = MutableFlowList.create<String>()
            assertTrue(emptyList.isEmpty)

            val populatedList = MutableFlowList.of("one", "two", "three")
            assertEquals(3, populatedList.size)
            assertEquals("one", populatedList[0])
            assertEquals("two", populatedList[1])
            assertEquals("three", populatedList[2])
        }

    @Test fun `set operation updates value and triggers flow`() =
        actionTest {
            val list = MutableFlowList.of("one", "two")

            list.listFlow.test {
                // Initial state
                assertEquals(listOf("one", "two"), awaitItem())

                // Update first item
                val oldValue = list.set(0, "new")
                assertEquals("one", oldValue)
                assertEquals("new", list[0])

                // Verify flow emission
                assertEquals(listOf("new", "two"), awaitItem())

                // Cancel to avoid waiting for more items
                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test fun `clear operation`() =
        actionTest {
            val list = MutableFlowList.of("one", "two", "three")
            val sizeEmission = list.sizeFlow.first()
            assertEquals(3, sizeEmission)

            list.clear()
            assertTrue(list.isEmpty)
            assertEquals(0, list.sizeFlow.first())
        }

    @Test fun `index operations`() =
        actionTest {
            val list = MutableFlowList.of("one", "two", "one", "three")

            assertEquals(0, list.indexOf("one"))
            assertEquals(2, list.lastIndexOf("one"))
            assertEquals(-1, list.indexOf("missing"))
            assertTrue("one" in list)
            assertFalse("missing" in list)
        }

    @Test fun `setIfDifferent updates value only if different`() =
        actionTest {
            val list = MutableFlowList.of("one", "two")

            // Attempt to set a new value that is different
            val updated = list.setIfDifferent(0, "new")
            assertTrue(updated) // Should return true as the value was changed
            assertEquals("new", list[0]) // Verify the value is updated

            // Attempt to set the same value
            val notUpdated = list.setIfDifferent(0, "new")
            assertFalse(notUpdated) // Should return false as the value is the same
            assertEquals("new", list[0]) // Verify the value remains unchanged
        }

    @Test fun `vararg constructor creates list with initial elements`() =
        actionTest {
            val list = MutableFlowList("one", "two", "three")

            assertEquals(3, list.size)
            assertEquals("one", list[0])
            assertEquals("two", list[1])
            assertEquals("three", list[2])

            list.listFlow.test {
                // Initial state should contain all elements
                assertEquals(listOf("one", "two", "three"), awaitItem())
                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test fun `toList and contents return snapshot of current elements`() =
        actionTest {
            val list = MutableFlowList("one", "two", "three")

            // Initial state
            assertEquals(listOf("one", "two", "three"), list.toList())
            assertEquals(listOf("one", "two", "three"), list.contents)

            // After modification
            list.add("four")
            assertEquals(listOf("one", "two", "three", "four"), list.toList())
            assertEquals(listOf("one", "two", "three", "four"), list.contents)

            // After removal
            list.remove("two")
            assertEquals(listOf("one", "three", "four"), list.toList())
            assertEquals(listOf("one", "three", "four"), list.contents)

            // Verify modifications to returned list don't affect original
            val snapshot = list.toList()
            snapshot as MutableList
            snapshot.add("five")
            assertEquals(listOf("one", "three", "four"), list.toList())
            assertEquals(3, list.size)
        }
}
