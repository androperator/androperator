package action.coroutine.flow

import app.cash.turbine.test
import androperator.test.ActionTest
import androperator.test.actionTest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlin.test.Test
import kotlin.test.assertEquals

class FlowCombineExtTest : ActionTest {
    @Test
    fun `test combineDistinct emits only distinct values`() =
        actionTest {
            val flow1 = MutableStateFlow(1)
            val flow2 = MutableStateFlow("A")

            combineDistinct(flow1, flow2) { a, b -> "$a-$b" }.test {
                // Initial emission
                assertEquals("1-A", awaitItem())

                // Same values should not trigger new emission
                flow1.value = 1
                flow2.value = "A"
                expectNoEvents()

                // Changing one value should trigger emission
                flow2.value = "B"
                assertEquals("1-B", awaitItem())

                // Changing the other value should also trigger emission
                flow1.value = 2
                assertEquals("2-B", awaitItem())

                // Setting same value again should not emit
                flow1.value = 2
                expectNoEvents()
            }
        }

    @Test
    fun `test combineDistinct with three flows`() =
        actionTest {
            val flow1 = MutableStateFlow(1)
            val flow2 = MutableStateFlow("A")
            val flow3 = MutableStateFlow(true)

            combineDistinct(flow1, flow2, flow3) { a, b, c -> "$a-$b-$c" }.test {
                // Initial emission
                assertEquals("1-A-true", awaitItem())

                // Changing only one value
                flow2.value = "B"
                assertEquals("1-B-true", awaitItem())

                // Changing another value
                flow3.value = false
                assertEquals("1-B-false", awaitItem())

                // No change, expect no events
                flow3.value = false
                expectNoEvents()
            }
        }

    @Test
    fun `test combineDistinct with iterable flows`() =
        actionTest {
            val flow1 = MutableStateFlow(1)
            val flow2 = MutableStateFlow(2)
            val flow3 = MutableStateFlow(3)

            combineDistinct(listOf(flow1, flow2, flow3)) { it.sum() }.test {
                // Initial emission
                assertEquals(6, awaitItem())

                // Update one of the values
                flow2.value = 4
                assertEquals(8, awaitItem())

                // Set same value, should not emit
                flow2.value = 4
                expectNoEvents()

                // Update another value
                flow3.value = 5
                assertEquals(10, awaitItem())
            }
        }
}
