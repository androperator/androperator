import copy
import unittest
from run import envelope, internet, parity, query
import json


class AssertionsTest(unittest.TestCase):
    def setUp(self):
        self.nodes = [dict(nodePath='0', accessibilityDataSensitive=True, label='Internet', resourceId=None),
                      dict(nodePath='0.0', accessibilityDataSensitive=False, label='Wi-Fi',
                           resourceId='com.android.settings:id/switchWidget', checkable=True,
                           checked=False, enabled=True, selected=False, clickable=True,
                           bounds=dict(left=1, top=2, right=3, bottom=4))]
        self.xml = '''<hierarchy><node package="com.android.settings" accessibility-data-sensitive="true"><node resource-id="com.android.settings:id/switchWidget" accessibility-data-sensitive="false" checkable="true" checked="false" enabled="true" selected="false" clickable="true" bounds="[1,2][3,4]" /></node></hierarchy>'''

    def test_known_values_and_parity(self):
        parity(self.nodes, self.xml)

    def test_device_xml_rejects_entity_definitions(self):
        for declaration in (
            '<!DOCTYPE hierarchy [<!ENTITY payload "expanded">]>',
            '<!DOCTYPE hierarchy SYSTEM "file:///etc/passwd">',
        ):
            with self.assertRaisesRegex(ValueError, "DOCTYPE"):
                parity(self.nodes, declaration + self.xml)

    def test_original_missing_root_is_failure(self):
        with self.assertRaises(AssertionError):
            envelope(dict(envelope=dict(commandId='query', taskId='query', status='failed', stepResults=[], errorCode='UI_TREE_UNAVAILABLE')))

    def test_empty_loading_wrong_root_and_missing_metadata_fail(self):
        for nodes in ([], self.nodes[:1], [dict(self.nodes[0], accessibilityDataSensitive=False), self.nodes[1]]):
            with self.assertRaises((AssertionError, IndexError)):
                internet(nodes)
        for value in (None, False):
            nodes = copy.deepcopy(self.nodes)
            nodes[0]['accessibilityDataSensitive'] = value
            with self.assertRaises(AssertionError):
                internet(nodes)

    def test_state_bounds_and_sensitivity_mismatch_fail(self):
        for old, new in [('checked="false"', 'checked="true"'), ('[1,2]', '[2,2]'), ('sensitive="false"', 'sensitive="true"'), ('com.android.settings"', 'com.android.systemui"')]:
            with self.assertRaises(AssertionError):
                parity(self.nodes, self.xml.replace(old, new))

    def test_old_payload_is_readable_without_inventing_false(self):
        nodes = copy.deepcopy(self.nodes)
        for node in nodes:
            del node['accessibilityDataSensitive']
        result = dict(envelope=dict(commandId='q', taskId='t', status='success', stepResults=[dict(success=True, data=dict(query=json.dumps(dict(schemaVersion=1, truncated=False, nodes=nodes, returnedCount=2))))]))
        self.assertIsNone(query(result)[0].get('accessibilityDataSensitive'))


if __name__ == '__main__':
    unittest.main()
