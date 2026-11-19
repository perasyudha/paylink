// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PayLink — tip any Agent ID holder by their name.ai handle
/// @notice Non-custodial, permissionless, no owner, no admin keys, no fees.
///         BNB sent to tip() is forwarded directly to the recipient in the same
///         transaction; this contract never holds user funds.
///         Agent ID resolution uses the official SPACE ID Agent ID registry.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
    function ownerOfHandle(string calldata handle) external view returns (address);
    function handleOf(address owner) external view returns (string memory);
}

contract PayLink {
    IAgentID public constant AGENT_ID = IAgentID(0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F);

    struct Profile {
        uint128 received; // total BNB received through PayLink (wei)
        uint64 tips;      // number of tips received
        string bio;       // short profile text set by the holder
    }

    struct Tip {
        address from;
        address to;
        uint128 amount;   // wei
        uint64 at;        // block timestamp
        string message;
    }

    uint256 public constant FEED_SIZE = 24;

    mapping(address => Profile) public profiles;
    Tip[24] private _feed;
    uint256 public feedCount;

    event Registered(address indexed who, string handle, string bio);
    event TipSent(address indexed from, address indexed to, string handle, uint256 amount, string message);

    /// @notice Register or update your profile. Caller must hold an Agent ID.
    function register(string calldata bio) external {
        require(AGENT_ID.balanceOf(msg.sender) > 0, "PayLink: caller holds no Agent ID");
        require(bytes(bio).length <= 160, "PayLink: bio over 160 bytes");
        profiles[msg.sender].bio = bio;
        emit Registered(msg.sender, AGENT_ID.handleOf(msg.sender), bio);
    }

    /// @notice Tip the holder of `handle` (lowercase, without .ai). Forwards BNB
    ///         directly to the recipient; never custodied here.
    function tip(string calldata handle, string calldata message) external payable {
        require(msg.value > 0, "PayLink: zero value");
        require(bytes(message).length <= 140, "PayLink: message over 140 bytes");
        address to = AGENT_ID.ownerOfHandle(handle);
        require(to != address(0), "PayLink: unknown handle");
        require(to != msg.sender, "PayLink: cannot tip yourself");
        (bool ok, ) = to.call{value: msg.value}("");
        require(ok, "PayLink: transfer failed");
        Profile storage p = profiles[to];
        p.received += uint128(msg.value);
        p.tips += 1;
        _feed[feedCount % FEED_SIZE] = Tip(msg.sender, to, uint128(msg.value), uint64(block.timestamp), message);
        unchecked { feedCount += 1; }
        emit TipSent(msg.sender, to, handle, msg.value, message);
    }

    /// @notice Recent tips ring buffer (newest at (feedCount-1) % 24) plus total count.
    function getFeed() external view returns (Tip[24] memory, uint256) {
        return (_feed, feedCount);
    }
}