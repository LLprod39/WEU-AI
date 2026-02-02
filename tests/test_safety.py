"""
Tests for safety module.

These tests verify that dangerous commands are properly blocked.
This is a critical security module.
"""
import pytest

from app.tools.safety import is_dangerous_command


class TestDangerousCommandDetection:
    """Tests for dangerous command detection."""

    # =========================================================================
    # Dangerous commands that MUST be blocked
    # =========================================================================

    @pytest.mark.parametrize(
        "command",
        [
            "rm -rf /",
            "rm -rf /home/user",
            "rm -rf .",
            "rm -rf *",
            "sudo rm -rf /var/log",
            "RM -RF /tmp",  # case insensitive
        ],
    )
    def test_blocks_rm_rf(self, command):
        """rm -rf commands should be blocked."""
        assert is_dangerous_command(command) is True

    @pytest.mark.parametrize(
        "command",
        [
            "rm -r /home/user/data",
            "rm -r .",
            "sudo rm -r /var/cache",
        ],
    )
    def test_blocks_rm_r(self, command):
        """rm -r commands should be blocked."""
        assert is_dangerous_command(command) is True

    @pytest.mark.parametrize(
        "command",
        [
            "mkfs.ext4 /dev/sda1",
            "mkfs.xfs /dev/nvme0n1p1",
            "mkfs /dev/sdb",
            "sudo mkfs.btrfs /dev/vda1",
        ],
    )
    def test_blocks_mkfs(self, command):
        """mkfs commands should be blocked."""
        assert is_dangerous_command(command) is True

    @pytest.mark.parametrize(
        "command",
        [
            "dd if=/dev/zero of=/dev/sda",
            "dd if=/dev/urandom of=/dev/sdb bs=4M",
            "sudo dd if=/dev/null of=/dev/nvme0n1",
        ],
    )
    def test_blocks_dd(self, command):
        """dd commands that write to devices should be blocked."""
        assert is_dangerous_command(command) is True

    @pytest.mark.parametrize(
        "command",
        [
            "shutdown -h now",
            "shutdown -r now",
            "sudo shutdown",
            "reboot",
            "sudo reboot",
        ],
    )
    def test_blocks_shutdown_reboot(self, command):
        """shutdown and reboot commands should be blocked."""
        assert is_dangerous_command(command) is True

    @pytest.mark.parametrize(
        "command",
        [
            "systemctl stop nginx",
            "systemctl disable docker",
            "systemctl mask sshd",
            "systemctl poweroff",
            "systemctl halt",
            "sudo systemctl stop postgresql",
        ],
    )
    def test_blocks_systemctl_stop(self, command):
        """systemctl stop/disable/mask commands should be blocked."""
        assert is_dangerous_command(command) is True

    @pytest.mark.parametrize(
        "command",
        [
            "service nginx stop",
            "service docker stop",
            "sudo service postgresql stop",
        ],
    )
    def test_blocks_service_stop(self, command):
        """service stop commands should be blocked."""
        assert is_dangerous_command(command) is True

    @pytest.mark.parametrize(
        "command",
        [
            "truncate -s 0 /var/log/syslog",
            "truncate -s 0 /var/lib/mysql/data.ibd",
        ],
    )
    def test_blocks_truncate(self, command):
        """truncate -s 0 commands should be blocked."""
        assert is_dangerous_command(command) is True

    # =========================================================================
    # Safe commands that should NOT be blocked
    # =========================================================================

    @pytest.mark.parametrize(
        "command",
        [
            "ls -la",
            "cat /etc/passwd",
            "df -h",
            "du -sh /home",
            "ps aux",
            "top -bn1",
            "tail -f /var/log/syslog",
            "grep error /var/log/nginx/error.log",
            "find /home -name '*.py'",
            "systemctl status nginx",  # status is safe
            "systemctl restart nginx",  # restart is safe
            "systemctl start docker",  # start is safe
            "service nginx status",  # status is safe
            "service nginx restart",  # restart is safe
            "rm /tmp/tempfile.txt",  # single file rm is ok
            "rm -f /tmp/cache.json",  # -f without -r is ok
            "",  # empty command
            None,  # None should not crash
        ],
    )
    def test_allows_safe_commands(self, command):
        """Safe commands should not be blocked."""
        # None case needs special handling
        if command is None:
            assert is_dangerous_command(command) is False
        else:
            assert is_dangerous_command(command) is False

    # =========================================================================
    # Edge cases
    # =========================================================================

    def test_empty_string_is_safe(self):
        """Empty string should be considered safe."""
        assert is_dangerous_command("") is False

    def test_whitespace_only_is_safe(self):
        """Whitespace-only string should be considered safe."""
        assert is_dangerous_command("   ") is False

    def test_partial_match_blocked(self):
        """Partial dangerous patterns should still be blocked."""
        assert is_dangerous_command("echo test && rm -rf /tmp") is True

    def test_quoted_dangerous_command_blocked(self):
        """Dangerous commands in quotes should still be blocked."""
        assert is_dangerous_command("bash -c 'rm -rf /'") is True

    def test_piped_dangerous_command_blocked(self):
        """Dangerous commands in pipes should still be blocked."""
        assert is_dangerous_command("ls | xargs rm -rf") is True
