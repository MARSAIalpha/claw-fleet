$key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP8GqxWDDcvz6bQULvgIkfxEesWaltNeBqR/yqjv6XD6 Rog@claw-fleet"

$machines = @(
    @{name="MacMini1"; ip="100.71.187.72"; user="apple"; pass="1234"},
    @{name="P4"; ip="100.79.7.113"; user="simonh"; pass="334420"},
    @{name="4090"; ip="100.110.240.106"; user="simon"; pass="334420"}
)

foreach ($m in $machines) {
    Write-Host "Adding key to $($m.name)..."

    $script = @"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo '$key' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
"@

    $result = sshpass -p $m.pass ssh -o StrictHostKeyChecking=no $m.user@$($m.ip) $script 2>&1
    Write-Host $result
}
